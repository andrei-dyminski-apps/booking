import type { PushPayload } from "@repo/contracts";

/** Where one push goes: the browser's endpoint and the keys the payload is encrypted to. */
export type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * What the push service answered, read into what the API does next (RFC 8030):
 * - `sent`: it took the push (`201`).
 * - `gone`: the browser dropped the subscription (`404`, `410`) — its row is deleted.
 * - `forbidden`: it refused the VAPID credentials (`403`) — a subscription made with another
 *   key, or a configuration every push service refuses alike. The row is kept until the
 *   browser has answered nothing else for `PUSH_FORBIDDEN_GRACE_HOURS`.
 * - `rejected`: it refused this push for good (any other `4xx`: a payload too large, a key
 *   that does not match), or the push could not be built — trying again would fail again.
 * - `throttled`: it asked to be left alone for a while (`429`, and its `Retry-After`).
 * - `unavailable`: a server error, a timeout or no answer — worth another try later.
 * `status` is the HTTP answer, `null` when there was none.
 */
export type PushOutcome =
  | { kind: "sent"; status: number }
  | { kind: "gone"; status: number }
  | { kind: "forbidden"; status: number }
  | { kind: "rejected"; status: number | null; reason: string }
  | { kind: "throttled"; status: number; retryAfter: Date | null }
  | { kind: "unavailable"; status: number | null; reason: string };

/**
 * The seam between the API and the push services (Web Push, RFC 8030): the real one signs
 * with the VAPID keys, the e2e specs record what would have been sent. `publicKey` is what
 * a browser subscribes with; `null` means push is not configured and nothing is sent.
 * `send` never throws: every answer, a failure included, is an outcome.
 */
export abstract class PushGateway {
  abstract readonly publicKey: string | null;

  abstract send(
    target: PushTarget,
    payload: PushPayload,
    ttlSeconds: number,
  ): Promise<PushOutcome>;
}
