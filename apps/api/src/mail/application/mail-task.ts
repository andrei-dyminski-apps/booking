import type { MailGroup } from "@repo/contracts";
import type { MailRequest } from "./ports/mail-gateway";

export const MAIL_SEND_ATTEMPTS = 6;
export const MAIL_PROCESSING_FAILURES = 24;

export class MailAttemptsExhausted extends Error {
  constructor(cause: unknown) {
    super("Mail delivery attempts exhausted", { cause });
  }
}

export class MailRetryExpired extends Error {
  static readonly reason = "Mail delivery retry window expired";

  constructor() {
    super(MailRetryExpired.reason);
  }
}

export class MailAccountDeliveryStopped extends Error {}

export type MailTask = {
  kind: "confirm" | "notice" | "digest" | "account";
  id: string;
  userId: string;
};

export type QueuedMail = MailTask & {
  requestId?: string | null;
  fromOutbox?: true;
  deliveryRound?: number;
};

export type PendingMail = QueuedMail & {
  createdAt: Date;
  availableAt: Date;
  deliveryRound: number;
};

export type DigestSnapshot = {
  subject: string;
  text: string;
  html: string;
  replyAddressHash: string | null;
};

export type MailAttempt = {
  startedAt: Date;
  digest: DigestSnapshot | null;
  delivery: DeliverySnapshot | null;
  rebuildDigest?: boolean;
};

export type DeliverySnapshot =
  | { kind: "account"; request: MailRequest }
  | { kind: "confirm"; request: MailRequest; token: string }
  | { kind: "notice"; request: MailRequest; group: MailGroup }
  | {
      kind: "digest";
      request: MailRequest;
      replyHash: string | null;
      throughId?: string;
    };

export function mailDeliveryKey(
  { kind, id }: MailTask,
  providerRetry = 0,
): string {
  const key = kind + "-" + id;
  return providerRetry === 0 ? key : key + "-retry-" + providerRetry;
}
