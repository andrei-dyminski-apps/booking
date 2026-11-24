import { Webhook } from "svix";
import { z } from "zod";
import {
  inboundRecipients,
  type MailEventInput,
} from "../application/mail-event";

const eventTime = z.iso.datetime({ offset: true });
const eventSchema = z.object({
  type: z.string(),
  created_at: eventTime,
  data: z.object({
    email_id: z.uuid(),
    created_at: eventTime.optional().catch(undefined),
    to: z.array(z.string()),
    cc: z.array(z.string()).nullish(),
    bcc: z.array(z.string()).nullish(),
    received_for: z.array(z.string()).nullish(),
    bounce: z.object({ type: z.string() }).optional(),
    failed: z.object({ reason: z.string() }).optional().catch(undefined),
  }),
});

export function readResendMailEvent(
  secret: string,
  rawBody: Buffer,
  body: unknown,
  headers: { id: string; timestamp: string; signature: string },
): MailEventInput | undefined {
  new Webhook(secret).verify(rawBody, {
    "svix-id": headers.id,
    "svix-timestamp": headers.timestamp,
    "svix-signature": headers.signature,
  });
  const { type, data, created_at } = eventSchema.parse(body);
  if (
    type !== "email.received" &&
    type !== "email.sent" &&
    type !== "email.delivered" &&
    type !== "email.delivery_delayed" &&
    type !== "email.failed" &&
    type !== "email.complained" &&
    type !== "email.suppressed" &&
    !(
      type === "email.bounced" &&
      data.bounce?.type.toLowerCase() === "permanent"
    )
  )
    return;

  return {
    id: headers.id,
    kind: type,
    emailId: data.email_id,
    createdAt: new Date(
      type === "email.received" ? (data.created_at ?? created_at) : created_at,
    ),
    recipients: type === "email.received" ? inboundRecipients(data) : data.to,
    ...(type === "email.failed" && {
      providerFailureReason: data.failed?.reason,
    }),
  };
}
