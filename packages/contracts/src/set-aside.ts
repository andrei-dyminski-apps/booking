import { z } from "zod";
import { bookingSchema } from "./booking.js";
import { stayNoticeSchema } from "./notification.js";
import { centsSchema, currencySchema } from "./money.js";
import { PAGING } from "./query.js";

/*
 * What the money paths set aside for a person, and what an admin does about it. Every admin
 * is told the moment something is set aside — four notices, `PAYMENT_EVENT_FAILED`,
 * `REFUND_FAILED`, `CANCELLATION_REFUND_FAILED` and `PAYOUT_FAILED` — and these are the
 * lists those notices lead to.
 * Each is newest first and nothing else — a queue of what went wrong is read from the top —
 * and the cursor still carries the sort, because every cursor of this API does.
 */

export const setAsideSortSchema = z.enum(["newest"]);

/**
 * A webhook event the inbox's worker gave up on. Not its payload: what the event says is the
 * provider's to show, and what a person needs here is which event, why, and since when.
 */
export const failedPaymentEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  attempts: z.int().min(0),
  lastError: z.string().nullable(),
  receivedAt: z.iso.datetime(),
  failedAt: z.iso.datetime(),
});

export const failedPaymentEventQuerySchema = z.object({
  ...PAGING,
});

export const failedPaymentEventPageSchema = z.object({
  items: z.array(failedPaymentEventSchema),
  nextCursor: z.string().nullable(),
});

/**
 * Open until a person has sent the money back some other way and said how; resolved after,
 * kept as the record of it.
 */
export const refundFailureStatusSchema = z.enum(["OPEN", "RESOLVED"]);

export const RefundFailureStatus = refundFailureStatusSchema.enum;

/**
 * A refund the guest's bank sent back. `stay` is `null` once no booking names the payment
 * any more; `paymentId` is kept for that case, so the money can still be found.
 */
export const refundFailureSchema = z.object({
  refundId: z.string(),
  paymentId: z.string(),
  amountCents: centsSchema,
  currency: currencySchema,
  /** The bank's reason as the provider words it. */
  reason: z.string().nullable(),
  failedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  /** How the money went back, in the words of whoever resolved it. */
  resolution: z.string().nullable(),
  stay: stayNoticeSchema.nullable(),
});

export const refundFailureQuerySchema = z.object({
  status: refundFailureStatusSchema.default(RefundFailureStatus.OPEN),
  ...PAGING,
});

export const refundFailurePageSchema = z.object({
  items: z.array(refundFailureSchema),
  nextCursor: z.string().nullable(),
});

export const MAX_RESOLUTION_LENGTH = 500;

/**
 * No "send it again": the usual reason is a card that expired or was closed, and the same
 * card refuses it again. The money goes back outside the provider, and this records that it
 * did.
 */
export const resolveRefundFailureSchema = z.object({
  resolution: z
    .string()
    .trim()
    .min(1, { error: "Say how the money went back" })
    .max(MAX_RESOLUTION_LENGTH, {
      error: `A resolution may not be longer than ${String(MAX_RESOLUTION_LENGTH)} characters`,
    }),
});

/**
 * Which of a stay's two background payments stopped retrying: the refund a cancellation owes
 * the guest, or the host's payout. Lower case, because it is a segment of the retry's path.
 */
export const stuckKindSchema = z.enum(["refund", "payout"]);

export const StuckKind = stuckKindSchema.enum;

/**
 * The stay whole, since the screen links to it, and `owedCents` — what the job would send:
 * the refund a cancellation owes the guest, or what the host is owed (`owedToHost`). The API
 * states it so the screen draws a figure instead of knowing the rule behind it.
 */
export const stuckStaySchema = z.object({
  kind: stuckKindSchema,
  booking: bookingSchema,
  owedCents: centsSchema,
  attempts: z.int().min(0),
  lastError: z.string().nullable(),
  failedAt: z.iso.datetime(),
});

export const stuckStayQuerySchema = z.object({
  kind: stuckKindSchema,
  ...PAGING,
});

export const stuckStayPageSchema = z.object({
  items: z.array(stuckStaySchema),
  nextCursor: z.string().nullable(),
});

export type SetAsideSort = z.infer<typeof setAsideSortSchema>;
export type FailedPaymentEvent = z.infer<typeof failedPaymentEventSchema>;
export type FailedPaymentEventQuery = z.infer<
  typeof failedPaymentEventQuerySchema
>;
export type FailedPaymentEventPage = z.infer<
  typeof failedPaymentEventPageSchema
>;
export type RefundFailureStatus = z.infer<typeof refundFailureStatusSchema>;
export type RefundFailure = z.infer<typeof refundFailureSchema>;
export type RefundFailureQuery = z.infer<typeof refundFailureQuerySchema>;
export type RefundFailurePage = z.infer<typeof refundFailurePageSchema>;
export type ResolveRefundFailureInput = z.infer<
  typeof resolveRefundFailureSchema
>;
export type StuckKind = z.infer<typeof stuckKindSchema>;
export type StuckStay = z.infer<typeof stuckStaySchema>;
export type StuckStayQuery = z.infer<typeof stuckStayQuerySchema>;
export type StuckStayPage = z.infer<typeof stuckStayPageSchema>;
