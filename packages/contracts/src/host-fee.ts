import { tz } from "@date-fns/tz";
import { isBefore, subHours } from "date-fns";
import { z } from "zod";
import { userSchema } from "./auth.js";
import { BookingStatus, DisputeStatus, type Booking } from "./booking.js";
import {
  centsSchema,
  currencySchema,
  NO_CENTS,
  shareOf,
  subtractCents,
  type Cents,
} from "./money.js";
import { checkInInstant } from "./check-in.js";
import { notRefunded } from "./refund.js";

/**
 * Here for the reason `refundQuote` is: the API charges a host by it, and the host's dialog
 * states it before the button, so a copy on each side would promise one fee and charge
 * another.
 *
 * A host who cancels a paid stay refunds its guest in full under any policy, and the fee is
 * what that costs them: the platform loses the processing fee of every full refund, and the
 * guest loses their plans. The closer to check-in, the more it costs.
 */

const DAY_HOURS = 24;

/**
 * The fee's tiers, widest window first: a host who cancels more than `hoursBefore` hours
 * before check-in pays `feeBps` of what the cancellation refunds — the stay's amount less
 * whatever went back already. "More than", like a refund tier — at the very moment a window
 * closes, the next one applies. Past the last tier the fee is `HOST_FEE_LAST_MINUTE_BPS`.
 */
export const HOST_FEE_TIERS: readonly {
  hoursBefore: number;
  feeBps: number;
}[] = [
  { hoursBefore: 30 * DAY_HOURS, feeBps: 1_000 },
  { hoursBefore: 48, feeBps: 2_500 },
];

/** Inside the last 48 hours: half the stay. */
export const HOST_FEE_LAST_MINUTE_BPS = 5_000;

/** How many cancellations by one host within `HOST_CANCELLATIONS_WINDOW_DAYS` tell every admin. */
export const HOST_CANCELLATIONS_THRESHOLD = 3;

export const HOST_CANCELLATIONS_WINDOW_DAYS = 365;

/** The fee and the share of the stay it is, worded beside the host's button. */
export type HostCancellationFee = { feeBps: number; cents: Cents };

const IN_UTC = { in: tz("UTC") };

/**
 * What cancelling this stay costs its host right now, measured from `checkInInstant` like
 * every refund window: a share of the payment the cancellation refunds — what the guest paid
 * less whatever went back already. Nothing for a hold, nor for a stay nobody paid for (the
 * seed's), one refunded in full already or one whose dispute was lost: declining a request
 * nobody has paid for costs the platform nothing and the guest only a search, a refund of
 * nothing loses no fee, and a lost dispute's money went back through the bank, so the
 * cancellation refunds nothing.
 */
export function hostCancellationFee(
  booking: Pick<
    Booking,
    | "status"
    | "paid"
    | "dispute"
    | "from"
    | "timeZone"
    | "checkInTime"
    | "amountCents"
    | "refundedAmountCents"
  >,
  now: Date,
): HostCancellationFee {
  const toRefund = notRefunded(
    booking.amountCents,
    booking.refundedAmountCents,
  );

  if (
    booking.status !== BookingStatus.CONFIRMED ||
    !booking.paid ||
    booking.dispute === DisputeStatus.LOST ||
    toRefund === NO_CENTS
  ) {
    return { feeBps: 0, cents: NO_CENTS };
  }

  const anchor = checkInInstant(booking);
  const tier = HOST_FEE_TIERS.find(({ hoursBefore }) =>
    isBefore(now, subHours(anchor, hoursBefore, IN_UTC)),
  );
  const feeBps = tier?.feeBps ?? HOST_FEE_LAST_MINUTE_BPS;

  return { feeBps, cents: shareOf(toRefund, feeBps) };
}

/**
 * One fee a host owes for a cancelled stay, as the host's payouts screen and an admin read
 * it. `withheldCents` is what has been taken out of the host's payouts towards it so far; a
 * fee is still owed while it is neither withheld in full nor waived. A waived fee keeps what
 * was withheld before the waiver.
 */
export const hostFeeSchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  hostId: z.uuid(),
  listingTitle: z.string(),
  from: z.iso.date(),
  to: z.iso.date(),
  amountCents: centsSchema,
  withheldCents: centsSchema,
  currency: currencySchema,
  /** The reason the host gave for the cancellation the fee is for. */
  cancellationReason: z.string().nullable(),
  waivedAt: z.iso.datetime().nullable(),
  waiveReason: z.string().nullable(),
  /**
   * The admin who waived it — for an admin only. A host is told that a fee was waived and
   * why, not which admin did; `null` as well while the fee is not waived.
   */
  waivedBy: userSchema.pick({ id: true, name: true }).nullable(),
  createdAt: z.iso.datetime(),
});

/**
 * One host's standing: the fees still owed, and every fee of the last
 * `HOST_CANCELLATIONS_WINDOW_DAYS` besides, waived ones included, newest first; how many paid
 * stays they cancelled in that window, not counting the ones whose fee an admin waived — the
 * count `HOST_CANCELLATIONS_THRESHOLD` is compared with; and what they still owe in all.
 * Bounded without a page — a host who cancels often enough to fill one is a conversation
 * with an admin, not a list.
 */
export const hostFeeOverviewSchema = z.object({
  cancellationsInWindow: z.int().min(0),
  owedCents: centsSchema,
  fees: z.array(hostFeeSchema),
});

/** `GET /host-fees` — the admin names the host; a host reads their own at `/host-fees/mine`. */
export const hostFeeQuerySchema = z.object({
  hostId: z.uuid(),
});

export const MAX_WAIVE_REASON_LENGTH = 500;

/** `POST /host-fees/:id/waive` — the circumstance a policy could not foresee, in a sentence. */
export const waiveHostFeeSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, { error: "Say why the fee is waived" })
    .max(MAX_WAIVE_REASON_LENGTH, {
      error: `A reason can be at most ${String(MAX_WAIVE_REASON_LENGTH)} characters long`,
    }),
});

/** What a host still owes of one fee: nothing once it is waived or withheld in full. */
export function stillOwed(
  fee: Pick<HostFee, "amountCents" | "withheldCents" | "waivedAt">,
): Cents {
  if (fee.waivedAt !== null || fee.withheldCents >= fee.amountCents) {
    return NO_CENTS;
  }

  return subtractCents(fee.amountCents, fee.withheldCents);
}

export type HostFee = z.infer<typeof hostFeeSchema>;
export type HostFeeOverview = z.infer<typeof hostFeeOverviewSchema>;
export type HostFeeQuery = z.infer<typeof hostFeeQuerySchema>;
export type WaiveHostFeeInput = z.infer<typeof waiveHostFeeSchema>;
