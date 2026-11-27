import { createECDH, createHash } from "node:crypto";
import { STATUS_CODES } from "node:http";
import { request } from "node:https";
import { Logger } from "@nestjs/common";
import {
  pushSubscriptionSchema,
  type PushPayload,
  type WebPushPayload,
} from "@repo/contracts";
import { addSeconds, isValid } from "date-fns";
import { generateRequestDetails, setVapidDetails } from "web-push";
import {
  PushGateway,
  type PushOutcome,
  type PushTarget,
} from "../application/ports/push-gateway";
import { isPushPublicKey } from "../domain/push-key";
import { PUSH_FORBIDDEN_GRACE_HOURS } from "../domain/push-policy";

/** A push service that does not answer in time is a try that failed, not a held job. */
const PUSH_TIMEOUT_MS = 10_000;

type VapidKeys = { subject: string; publicKey: string; privateKey: string };

/**
 * What a push service's HTTP answer means. Exported for its spec: the status codes are the
 * whole of the feedback a push service gives, so reading them is the part worth pinning.
 */
export function outcomeOf(
  status: number,
  headers: { "retry-after"?: string | undefined },
  now: Date,
): PushOutcome {
  if (status >= 200 && status < 300) return { kind: "sent", status };

  // 404 and 410 are the two answers RFC 8030 gives for a subscription that is no more.
  if (status === 404 || status === 410) return { kind: "gone", status };

  // A 403 is a refusal of the VAPID credentials: a subscription made with another key after a
  // rotation, but also a subject or a clock every push service refuses alike, so it says
  // nothing certain about this one browser and its row is not deleted on the spot.
  if (status === 403) return { kind: "forbidden", status };

  if (status === 429) {
    return {
      kind: "throttled",
      status,
      retryAfter: retryAfterOf(headers["retry-after"], now),
    };
  }

  const reason = `${String(status)} ${STATUS_CODES[status] ?? "Unexpected HTTP status"}`;

  return status >= 500
    ? { kind: "unavailable", status, reason }
    : { kind: "rejected", status, reason };
}

/** `Retry-After` is either a number of seconds or an HTTP date (RFC 9110). */
function retryAfterOf(value: string | undefined, now: Date): Date | null {
  if (value === undefined) return null;

  const date = /^\d+$/.test(value.trim())
    ? addSeconds(now, Number(value))
    : new Date(value);

  return isValid(date) ? date : null;
}

export class WebPushGateway extends PushGateway {
  private readonly logger = new Logger(WebPushGateway.name);

  constructor(private readonly vapid: VapidKeys) {
    super();
    // Checks the subject and both keys, and throws on a malformed one: at boot rather than
    // as a failure logged at every push.
    setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    const key = createECDH("prime256v1");
    key.setPrivateKey(vapid.privateKey, "base64url");
    if (!key.getPublicKey().equals(Buffer.from(vapid.publicKey, "base64url"))) {
      throw new Error("VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY");
    }
  }

  get publicKey(): string {
    return this.vapid.publicKey;
  }

  async send(
    target: PushTarget,
    payload: PushPayload,
    ttlSeconds: number,
  ): Promise<PushOutcome> {
    // Checked again before the request, for a row written around the API: the endpoint is
    // where this server posts to. An invalid target cannot recover on retry.
    const parsed = pushSubscriptionSchema.safeParse({
      endpoint: target.endpoint,
      keys: { p256dh: target.p256dh, auth: target.auth },
    });
    if (
      !parsed.success ||
      parsed.data.endpoint !== target.endpoint ||
      !isPushPublicKey(parsed.data.keys.p256dh)
    ) {
      return {
        kind: "rejected",
        status: null,
        reason: "Invalid stored push subscription",
      };
    }

    // Never the endpoint in a log line: it is the browser's capability to be pushed to.
    const host = new URL(parsed.data.endpoint).host;
    let details: ReturnType<typeof generateRequestDetails>;

    try {
      const message: WebPushPayload = {
        ...payload,
        subscriptionFingerprint: createHash("sha256")
          .update(Buffer.from(parsed.data.keys.auth, "base64url"))
          .digest("hex"),
      };
      details = generateRequestDetails(parsed.data, JSON.stringify(message), {
        vapidDetails: this.vapid,
        TTL: ttlSeconds,
      });
    } catch (error) {
      // Signing and encryption depend on nothing a later try would change.
      const outcome: PushOutcome = {
        kind: "rejected",
        status: null,
        reason: `Could not build the push request: ${String(error)}`,
      };
      this.logger.error(`A push to ${host} failed: ${outcome.reason}`);

      return outcome;
    }

    let outcome: PushOutcome;
    try {
      outcome = await postPush(details);
    } catch {
      outcome = {
        kind: "unavailable",
        status: null,
        reason: "Push request failed before receiving an HTTP response",
      };
    }

    if (outcome.kind === "forbidden") {
      this.logger.error(
        `A push to ${host} was refused with 403: check VAPID_SUBJECT, the VAPID keys and the server clock; a browser refused for ${String(PUSH_FORBIDDEN_GRACE_HOURS)} hours loses its subscription`,
      );
    } else if (outcome.kind === "rejected" || outcome.kind === "unavailable") {
      this.logger.warn(`A push to ${host} failed: ${outcome.reason}`);
    }

    return outcome;
  }
}

/** The headers settle the outcome even if the response body is interrupted. */
function postPush({
  endpoint,
  method,
  headers,
  body,
}: ReturnType<typeof generateRequestDetails>): Promise<PushOutcome> {
  return new Promise((resolve, reject) => {
    const req = request(
      endpoint,
      { method, headers, signal: AbortSignal.timeout(PUSH_TIMEOUT_MS) },
      (response) => {
        response.once("error", reject);
        if (response.statusCode === undefined) {
          reject(new Error("Push response had no HTTP status"));
        } else {
          resolve(outcomeOf(response.statusCode, response.headers, new Date()));
        }
        response.resume();
      },
    );
    req.once("error", reject);
    req.end(body ?? undefined);
  });
}

/** Push with no keys set: browsers are offered nothing to subscribe with. */
export class DisabledPushGateway extends PushGateway {
  readonly publicKey = null;

  send(): Promise<PushOutcome> {
    return Promise.resolve({
      kind: "rejected",
      status: null,
      reason: "Push is not configured",
    });
  }
}

/**
 * What the e2e specs read back: every push taken, in order. An endpoint in `gone` answers as
 * a dropped browser; one with outcomes queued in `script` answers those first, one a try.
 */
export class InMemoryPushGateway extends PushGateway {
  readonly publicKey = "BPushKeyOfTheEndToEndSpecs";

  readonly sent: { endpoint: string; payload: PushPayload }[] = [];

  readonly gone = new Set<string>();

  readonly script = new Map<string, PushOutcome[]>();

  send(target: PushTarget, payload: PushPayload): Promise<PushOutcome> {
    const scripted = this.script.get(target.endpoint)?.shift();

    if (scripted !== undefined && scripted.kind !== "sent") {
      return Promise.resolve(scripted);
    }

    if (this.gone.has(target.endpoint)) {
      return Promise.resolve({ kind: "gone", status: 410 });
    }

    this.sent.push({ endpoint: target.endpoint, payload });

    return Promise.resolve({ kind: "sent", status: 201 });
  }
}

/**
 * Push is optional: with none of the three variables set it is off, and the profile page
 * offers nothing. Some of them set is a mistake made while configuring it, and stops the
 * process at boot rather than turning push off in silence.
 */
export function pushGateway(): PushGateway {
  if (process.env.NODE_ENV === "test") return new InMemoryPushGateway();

  const subject = process.env.VAPID_SUBJECT || undefined;
  const publicKey = process.env.VAPID_PUBLIC_KEY || undefined;
  const privateKey = process.env.VAPID_PRIVATE_KEY || undefined;

  if (!subject && !publicKey && !privateKey) return new DisabledPushGateway();

  if (!subject || !publicKey || !privateKey) {
    throw new Error(
      "Set all of VAPID_SUBJECT, VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or none of them",
    );
  }

  return new WebPushGateway({ subject, publicKey, privateKey });
}
