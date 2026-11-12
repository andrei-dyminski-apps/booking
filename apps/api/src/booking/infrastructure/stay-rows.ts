import {
  checkInInstant,
  type Booking,
  type CheckIn,
  type StayQuote,
} from "@repo/contracts";
import {
  type Prisma,
  ReviewKind,
  type Booking as BookingRow,
  type Listing as ListingRow,
  type Review as ReviewRow,
} from "../../generated/prisma/client";
import { toIsoDate } from "../../common/iso-date";
import {
  cents,
  chargeRefusal,
  CURRENCY,
  currencySchema,
  type Cents,
} from "../../payment/domain/money";
import { UnchargeableStayError } from "../domain/booking.errors";
import type {
  ReleasedHold,
  RefundTarget,
  StayMoney,
} from "../domain/booking.types";

/*
 * A stay's money and its two people off a row, and the stay as the contract answers it. A
 * file of its own because `PayoutRepository` and the three booking repositories read the
 * same rows, and a row mapping does not cross between two repositories — the shape
 * `listing-pricing.ts` has.
 */

/**
 * What every read of a booking selects from the listing it names, and it is not narrowed
 * by `deleted_at`: a retired listing is still where the stay was, and resolving it here is
 * the only way its guest ever learns the title again — see `listingSummarySchema` in the
 * contract. Any extra column a caller selects alongside it (the owner, for the
 * authorization rules) stays out of the answer, because `toBooking` names the two fields
 * it copies rather than spreading the row.
 */
const LISTING_SUMMARY = {
  listing: { select: { title: true, pricePerNightCents: true, ownerId: true } },
} satisfies Prisma.BookingInclude;

/**
 * Which halves of the stay have been reviewed, read beside the listing on every booking —
 * the contract's `reviewed`. The kinds and nothing else: what a review says is read through
 * the lists that are scoped for it, and a booking is read by both of the people it names.
 * At most two rows, found through the unique `(booking_id, kind)` pair.
 */
const REVIEW_KINDS = {
  reviews: { select: { kind: true } },
} satisfies Prisma.BookingInclude;

/** Everything `toBooking` reads off a row besides its own columns. */
export const BOOKING_INCLUDE = {
  ...LISTING_SUMMARY,
  ...REVIEW_KINDS,
} satisfies Prisma.BookingInclude;

/** A stored booking with the listing columns the contract's `listing` is built from. */
export type BookingRowWithListing = BookingRow & {
  listing: Pick<ListingRow, "title" | "pricePerNightCents" | "ownerId">;
  reviews: Pick<ReviewRow, "kind">[];
};

/**
 * What a released hold is read back with: the listing's title for the notice and its owner
 * for the recipient. `updateManyAndReturn` loads to-one relations only, which is all this
 * needs — the reviews `toBooking` reads are not wanted here.
 */
export const RELEASED_HOLD_INCLUDE = {
  listing: { select: { title: true, ownerId: true } },
} satisfies Prisma.BookingIncludeUpdateManyAndReturn;

/** A nullable money column as the type the rules count in; `cents` refuses what is not whole. */
export function nullableCentsOf(column: number | null): Cents | null {
  return column === null ? null : cents(column);
}

/**
 * The currency is parsed rather than cast: the column is `char(3)` held to the contract's
 * list by a `CHECK`, and a value outside it is a row this API cannot charge or answer.
 */
export function toStayMoney(
  row: Pick<
    BookingRow,
    "amountCents" | "currency" | "refundedAmountCents" | "refundOwedCents"
  >,
): StayMoney {
  return {
    amountCents: cents(row.amountCents),
    currency: currencySchema.parse(row.currency),
    refundedAmountCents: nullableCentsOf(row.refundedAmountCents),
    refundOwedCents: nullableCentsOf(row.refundOwedCents),
  };
}

/**
 * What a stay's quote writes: the amount, the currency it is charged in, the nights it adds
 * up from and the discount its rate took off them, in one insert. A quote one payment could
 * not carry — `chargeRefusal`, the rule the booking form applies, read after the discount
 * since that is what is charged — is refused before anything is written.
 * `BookingRepository.create` and the seed both write through this, so neither can store a
 * stay the other would price or bound differently.
 */
export function stayMoneyData(
  quote: StayQuote,
): Pick<
  Prisma.BookingUncheckedCreateInput,
  "amountCents" | "discountCents" | "currency" | "nights"
> {
  const refusal = chargeRefusal(quote.amountCents);

  if (refusal !== null) {
    throw new UnchargeableStayError(quote.amountCents, refusal);
  }

  return {
    amountCents: quote.amountCents,
    discountCents: quote.discountCents,
    currency: CURRENCY,
    nights: {
      create: quote.nights.map((night) => ({
        date: new Date(night.date),
        priceCents: night.priceCents,
      })),
    },
  };
}

/**
 * What a stay copies of its listing's check-in, and the moment that makes of its check-in
 * day (`checkInInstant`) — written beside them once, since none of the three ever changes
 * on a stay. `BookingRepository.create` and the seed both write through this, so the moment
 * the payout sweep cuts by is never out of step with the one every rule reads.
 */
export function checkInData(
  checkIn: CheckIn,
): Pick<
  Prisma.BookingUncheckedCreateInput,
  "timeZone" | "checkInTime" | "checkInAt"
> {
  return {
    timeZone: checkIn.timeZone,
    checkInTime: checkIn.checkInTime,
    checkInAt: checkInInstant(checkIn),
  };
}

/** The one reading of a stay's money, which `PayoutRepository` extends with its own. */
export function toRefundTarget(
  row: BookingRow & { listing: Pick<ListingRow, "title" | "ownerId"> },
): RefundTarget {
  return {
    ...toStayMoney(row),
    bookingId: row.id,
    status: row.status,
    paid: row.paidAt !== null,
    confirmationAnnounced: row.confirmationAnnouncedAt !== null,
    hold: toReleasedHold(row),
  };
}

export function toReleasedHold(
  row: BookingRow & { listing: Pick<ListingRow, "title" | "ownerId"> },
): ReleasedHold {
  return {
    stay: {
      bookingId: row.id,
      listingId: row.listingId,
      listingTitle: row.listing.title,
      from: toIsoDate(row.from),
      to: toIsoDate(row.to),
    },
    checkIn: {
      from: toIsoDate(row.from),
      timeZone: row.timeZone,
      checkInTime: row.checkInTime,
    },
    guestId: row.guestId,
    listingOwnerId: row.listing.ownerId,
    paymentId: row.paymentIntentId,
  };
}

export function toBooking(row: BookingRowWithListing): Booking {
  return {
    id: row.id,
    listingId: row.listingId,
    // Named field by field rather than spread: a caller that selects more of the listing
    // than the summary — the owner, for the authorization rules — must not have it leak
    // into a response body.
    listing: {
      title: row.listing.title,
      pricePerNightCents: cents(row.listing.pricePerNightCents),
    },
    guestId: row.guestId,
    hostId: row.listing.ownerId,
    from: toIsoDate(row.from),
    to: toIsoDate(row.to),
    status: row.status,
    ...toStayMoney(row),
    cancellationPolicy: row.cancellationPolicy,
    timeZone: row.timeZone,
    checkInTime: row.checkInTime,
    paid: row.paidAt !== null,
    dispute: row.disputeStatus,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    cancelledBy: row.cancelledBy,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    endedEarlyAt: row.endedEarlyAt?.toISOString() ?? null,
    reviewed: {
      byGuest: row.reviews.some((review) => review.kind === ReviewKind.LISTING),
      byOwner: row.reviews.some((review) => review.kind === ReviewKind.GUEST),
    },
  };
}
