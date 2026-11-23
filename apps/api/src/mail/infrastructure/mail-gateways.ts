import { tz } from "@date-fns/tz";
import {
  addDays,
  addMonths,
  addSeconds,
  startOfDay,
  startOfMonth,
} from "date-fns";
import { createTransport } from "nodemailer";
import { z } from "zod";

import { mailSiteOrigin } from "../application/mail-content";
import {
  InboundMailAboveQuotaError,
  MailDeliveryError,
  MailIdempotencyConflict,
  MAIL_PROVIDER_TIMEOUT_MS,
  MailGateway,
  MailQuotaError,
  MailRateLimitError,
  type Letter,
  type MailRequest,
  type ReceivedLetter,
} from "../application/ports/mail-gateway";

const received = z.object({
  to: z.array(z.string()),
  cc: z.array(z.string()).nullish(),
  bcc: z.array(z.string()).nullish(),
  received_for: z.array(z.string()).nullish(),
  text: z.string().nullish(),
  html: z.string().nullish(),
  headers: z.record(z.string(), z.string()).nullish(),
});

const automaticMailHeaders = {
  "Auto-Submitted": "auto-generated",
  "X-Auto-Response-Suppress": "All",
};

const wireLetter = z.object({
  to: z.string(),
  from: z.string(),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
  reply_to: z.string().optional(),
  headers: z.record(z.string(), z.string()),
});
const resendError = z.object({ name: z.string() });
const utc = { in: tz("UTC") };

async function resendErrorName(response: Response) {
  const result = resendError.safeParse(
    await response.json().catch(() => undefined),
  );
  return result.data?.name;
}

function prepareRequest(
  { replyTo, ...letter }: Letter,
  from: string,
): MailRequest {
  return {
    to: letter.to,
    body: JSON.stringify({
      ...letter,
      from,
      reply_to: replyTo,
      headers: automaticMailHeaders,
    }),
  };
}

export function readMailRequest({ body }: MailRequest) {
  const { reply_to: replyTo, ...letter } = wireLetter.parse(JSON.parse(body));
  return { ...letter, replyTo };
}

export class ResendGateway extends MailGateway {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    super();
  }
  prepare(letter: Letter) {
    return prepareRequest(letter, this.from);
  }
  async send({ body }: MailRequest, key: string) {
    const response = await this.request("/emails", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body,
    });
    await response.body?.cancel();
  }
  async receive(id: string) {
    const response = await this.request(
      "/emails/receiving/" + encodeURIComponent(id) + "?html_format=cid",
      {},
    );
    return received.parse(await response.json());
  }
  override async sentRecipients(id: string) {
    const response = await this.request(
      "/emails/" + encodeURIComponent(id),
      {},
    );
    return z.object({ to: z.array(z.string()) }).parse(await response.json())
      .to;
  }
  override async isSuppressed(email: string) {
    try {
      const response = await this.request(
        "/suppressions/" + encodeURIComponent(email),
        {},
        3000,
      );
      await response.body?.cancel();
      return true;
    } catch (error) {
      if (error instanceof MailDeliveryError && error.status === 404)
        return false;
      throw error;
    }
  }
  private async request(
    path: string,
    init: RequestInit,
    timeout = MAIL_PROVIDER_TIMEOUT_MS,
  ) {
    const response = await fetch("https://api.resend.com" + path, {
      ...init,
      signal: AbortSignal.timeout(timeout),
      headers: {
        Authorization: "Bearer " + this.apiKey,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      if (
        path === "/emails" &&
        init.method === "POST" &&
        response.status === 429
      ) {
        const name = await resendErrorName(response);
        if (
          name === "daily_quota_exceeded" ||
          name === "monthly_quota_exceeded"
        ) {
          const providerTime = Date.parse(response.headers.get("date") ?? "");
          const at = Number.isNaN(providerTime) ? Date.now() : providerTime;
          throw new MailQuotaError(
            name === "daily_quota_exceeded"
              ? startOfDay(addDays(at, 1, utc), utc)
              : startOfMonth(addMonths(at, 1, utc), utc),
          );
        }
        if (name === "rate_limit_exceeded") {
          const seconds = ["retry-after", "ratelimit-reset"]
            .map((header) => Number(response.headers.get(header)))
            .find((value) => Number.isSafeInteger(value) && value > 0);
          throw new MailRateLimitError(addSeconds(Date.now(), seconds ?? 1));
        }
      } else if (
        response.status === 409 &&
        path === "/emails" &&
        init.method === "POST"
      ) {
        if ((await resendErrorName(response)) === "invalid_idempotent_request")
          throw new MailIdempotencyConflict();
      } else if (
        response.status === 403 &&
        path.startsWith("/emails/receiving/")
      ) {
        if ((await resendErrorName(response)) === "email_above_quota")
          throw new InboundMailAboveQuotaError();
      } else {
        await response.body?.cancel();
      }
      throw new MailDeliveryError(
        "Resend returned HTTP " + String(response.status),
        response.status,
      );
    }
    return response;
  }
}
export class MailpitGateway extends MailGateway {
  private readonly transport;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    super();
    const smtp = new URL(url);
    smtp.searchParams.set("dnsTimeout", "3000");
    smtp.searchParams.set("connectionTimeout", "3000");
    smtp.searchParams.set("greetingTimeout", "3000");
    smtp.searchParams.set("socketTimeout", "5000");
    this.transport = createTransport(smtp.href);
  }
  prepare(letter: Letter) {
    return prepareRequest(letter, this.from);
  }
  async send(request: MailRequest, key: string) {
    try {
      await this.transport.sendMail({
        ...readMailRequest(request),
        messageId: "<" + key + "@mailpit.local>",
      });
    } catch {
      throw new MailDeliveryError("Mailpit did not accept the message");
    }
  }
  receive(): Promise<ReceivedLetter> {
    return Promise.reject(
      new MailDeliveryError("Mailpit has no Resend inbox", 404),
    );
  }
  sentRecipients(): Promise<string[]> {
    return Promise.resolve([]);
  }
  isSuppressed(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
export class InMemoryMailGateway extends MailGateway {
  readonly sent = new Map<string, ReturnType<typeof readMailRequest>>();
  readonly received = new Map<string, ReceivedLetter>();
  readonly suppressed = new Set<string>();
  isSuppressed(email: string) {
    return Promise.resolve(this.suppressed.has(email));
  }
  prepare(letter: Letter) {
    return prepareRequest(
      letter,
      process.env.MAIL_FROM || "staydesk@mail.test",
    );
  }
  send(request: MailRequest, key: string) {
    const letter = readMailRequest(request);
    if (!this.suppressed.has(letter.to)) this.sent.set(key, letter);
    return Promise.resolve();
  }
  receive(id: string) {
    const letter = this.received.get(id);
    if (!letter)
      return Promise.reject(
        new MailDeliveryError("Unknown received email", 404),
      );
    return Promise.resolve(letter);
  }
  sentRecipients(id: string) {
    const letter = this.sent.get(id);
    return Promise.resolve(letter ? [letter.to] : []);
  }
}
export function mailGateway(): MailGateway {
  if (process.env.NODE_ENV === "test") return new InMemoryMailGateway();
  const from = process.env.MAIL_FROM || "staydesk@mail.local";
  if (process.env.MAIL_SMTP_URL || process.env.NODE_ENV !== "production")
    return new MailpitGateway(
      process.env.MAIL_SMTP_URL || "smtp://localhost:1025",
      from,
    );
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM)
    throw new Error("Set RESEND_API_KEY and MAIL_FROM for Resend");
  if (!process.env.RESEND_WEBHOOK_SECRET || !process.env.MAIL_REPLY_DOMAIN)
    throw new Error(
      "Set RESEND_WEBHOOK_SECRET and MAIL_REPLY_DOMAIN for incoming mail",
    );
  mailSiteOrigin();
  return new ResendGateway(process.env.RESEND_API_KEY, from);
}
