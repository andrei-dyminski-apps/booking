export const MAIL_PROVIDER_TIMEOUT_MS = 5000;

export type Letter = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

export type ReceivedLetter = {
  to: string[];
  cc?: string[] | null | undefined;
  bcc?: string[] | null | undefined;
  received_for?: string[] | null | undefined;
  text?: string | null | undefined;
  html?: string | null | undefined;
  headers?: Record<string, string> | null | undefined;
};

export type MailRequest = { to: string; body: string };

export abstract class MailGateway {
  abstract prepare(letter: Letter): MailRequest;
  abstract send(request: MailRequest, key: string): Promise<void>;
  abstract receive(id: string): Promise<ReceivedLetter>;
  abstract sentRecipients(id: string): Promise<string[]>;
  abstract isSuppressed(email: string): Promise<boolean>;
}

/** A diagnostic safe to include in a job log. */
export class MailDeliveryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MailDeliveryError";
  }
}

export function mailFailureStatus(error: unknown): number | undefined {
  return error instanceof MailDeliveryError ? error.status : undefined;
}

export class MailIdempotencyConflict extends MailDeliveryError {
  constructor() {
    super("Resend returned HTTP 409: invalid_idempotent_request", 409);
  }
}

export function isPermanentMailFailure(error: unknown): boolean {
  if (error instanceof MailIdempotencyConflict) return true;
  const status = mailFailureStatus(error);
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    ![408, 409, 425, 429].includes(status)
  );
}

export function mailFailureText(error: unknown): string {
  if (error instanceof MailIdempotencyConflict) return error.message;
  const status = mailFailureStatus(error);
  if (status !== undefined)
    return "Mail provider returned HTTP " + String(status);
  if (error instanceof MailDeliveryError) return error.message;
  return error instanceof Error ? error.name : "Unknown error";
}

/** The provider explicitly refused the send and supplied a later delivery window. */
export class MailDeferredError extends MailDeliveryError {
  constructor(
    message: string,
    readonly retryAt: Date,
  ) {
    super(message, 429);
  }
}

export class MailQuotaError extends MailDeferredError {
  constructor(retryAt: Date) {
    super("Resend email quota exhausted", retryAt);
  }
}

export class MailRateLimitError extends MailDeferredError {
  constructor(retryAt: Date) {
    super("Resend request rate limit reached", retryAt);
  }
}

export class InboundMailAboveQuotaError extends MailDeliveryError {
  constructor() {
    super("Resend cannot retrieve an email received above quota", 403);
  }
}
