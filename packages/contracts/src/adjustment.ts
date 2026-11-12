import { z } from "zod";
import { userSchema } from "./auth.js";
import { DisputeStatus, type Booking } from "./booking.js";
import {
  cents,
  centsSchema,
  currencySchema,
  minCents,
  NO_CENTS,
  subtractCents,
  type Cents,
} from "./money.js";
import { isCancellableOn, notRefunded } from "./refund.js";
import { refundFailureStatusSchema } from "./set-aside.js";

/** What an admin's refund leaves of a stay that can still be cancelled. */
const KEPT_BEFORE_CHECK_IN = cents(1);

/**
 * Here for the reason `refundQuote` is: the API refuses a refund past it, and the admin's
 * dialog states it before the button, so a copy on each side would offer one ceiling and
 * enforce another.
 *
 * What an admin may still give back of a stay without cancelling it: what the guest paid less
 * what went back already and less what a cancellation still owes them — that debt is on its
 * way out through its own job. Nothing for a stay nobody paid for, nor for one whose dispute
 * was lost: the bank gave that money back already.
 *
 * A stay that can still be cancelled at `now` (`isCancellableOn`) keeps its last cent:
 * `charge.refunded` cancels a stay not yet begun once it is refunded in full, so giving all of
 * it back would be a cancellation nobody asked for — no canceller, no reason, the nights let
 * go. Refunding all of it is `DELETE /bookings/:id`'s.
 */
export function refundableCents(
  stay: Pick<
    Booking,
    | "status"
    | "from"
    | "timeZone"
    | "checkInTime"
    | "endedEarlyAt"
    | "paid"
    | "dispute"
    | "amountCents"
    | "refundedAmountCents"
    | "refundOwedCents"
  >,
  now: Date,
): Cents {
  if (!stay.paid || stay.dispute === DisputeStatus.LOST) return NO_CENTS;

  const notGone = notRefunded(stay.amountCents, stay.refundedAmountCents);
  const left = subtractCents(
    notGone,
    minCents(notGone, stay.refundOwedCents ?? NO_CENTS),
  );

  return isCancellableOn(stay, now)
    ? subtractCents(left, minCents(left, KEPT_BEFORE_CHECK_IN))
    : left;
}

export const MAX_ADJUSTMENT_REASON_LENGTH = 500;

/**
 * `POST /bookings/:id/refunds` — a part of the payment given back by an admin, the stay left
 * as it is. `requestId` is minted by the dialog when it opens and names the refund at the
 * provider, so a second press — or a retry after a lost answer — is the same refund, not
 * another one. The ceiling is the stay's on the day (`refundableCents`), so the API checks it.
 */
export const adminRefundSchema = z.object({
  amountCents: centsSchema.refine((amount) => amount > 0, {
    error: "Name an amount to refund",
  }),
  reason: z
    .string()
    .trim()
    .min(1, { error: "Say why the money goes back — the record keeps it" })
    .max(MAX_ADJUSTMENT_REASON_LENGTH, {
      error: `A reason can be at most ${String(MAX_ADJUSTMENT_REASON_LENGTH)} characters long`,
    }),
  requestId: z.uuid(),
});

/**
 * One refund an admin sent for a stay outside a cancellation: who, how much, why, and the
 * provider's id of the refund — what a person reconciling the stay against the provider
 * looks up. Read by admins only.
 *
 * `refundId` is `null` for a press only claimed: the provider was asked for `amountCents`
 * and no answer was recorded, so the refund may or may not have gone out. Pressing again
 * with its `requestId`, its amount and its reason records the refund that went out, or sends
 * it — never a second one. `bounce` is the refund's bank sending it back, as the bounced
 * refunds list has it: open while the money is still the guest's to get some other way,
 * resolved once an admin recorded how; `null` for a refund nothing sent back.
 */
export const bookingAdjustmentSchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  requestId: z.uuid(),
  amountCents: centsSchema,
  currency: currencySchema,
  reason: z.string(),
  refundId: z.string().nullable(),
  bounce: refundFailureStatusSchema.nullable(),
  admin: userSchema.pick({ id: true, name: true }),
  createdAt: z.iso.datetime(),
});

export const bookingAdjustmentListSchema = z.array(bookingAdjustmentSchema);

export type AdminRefundInput = z.infer<typeof adminRefundSchema>;
export type BookingAdjustment = z.infer<typeof bookingAdjustmentSchema>;
