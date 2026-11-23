import type { ReceivedLetter } from "./ports/mail-gateway";

export function inboundRecipients(
  letter: Pick<ReceivedLetter, "to" | "cc" | "bcc" | "received_for">,
): string[] {
  return [
    ...letter.to,
    ...(letter.cc ?? []),
    ...(letter.bcc ?? []),
    ...(letter.received_for ?? []),
  ];
}

export const MAIL_EVENT_ATTEMPTS = 24;

export type MailEventInput = {
  id: string;
  kind: string;
  emailId: string;
  createdAt: Date;
  recipients: string[];
};

export type StoredMailEventInput = MailEventInput & {
  replyTokenHash: string | null;
};

export type MailEvent = Omit<StoredMailEventInput, "recipients"> & {
  recipientIds: string[];
  lookupRecipients: boolean;
  processedAt: Date | null;
  availableAt: Date;
  attempts: number;
};
