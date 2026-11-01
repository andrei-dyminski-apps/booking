import type {
  Prisma,
  Booking as BookingRow,
  Listing as ListingRow,
} from "../../generated/prisma/client";
import { toIsoDate } from "../../common/iso-date";
import {
  cents,
  CURRENCY,
  currencySchema,
  type Cents,
} from "../../payment/domain/money";
import {
  StayTooCheapError,
  StayTooExpensiveError,
} from "../domain/booking.errors";
import type {
  ReleasedHold,
  RefundTarget,
  StayMoney,
} from "../domain/booking.types";
import { MAX_CHARGE, MIN_CHARGE, type StayQuote } from "../domain/stay-price";

/*
 * A stay's money and its two people off a row. A file of its own because `PayoutRepository`
 * reads the same rows, and a row mapping does not cross between two repositories — the
 * shape `listing-pricing.ts` has.
 */

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
 * What a stay's quote writes: the amount, the currency it is charged in and the nights it
 * adds up from, in one insert. A quote one payment could not carry is refused before
 * anything is written — `BookingRepository.create` and the seed both write through this, so
 * neither can store a stay the other would price or bound differently.
 */
export function stayMoneyData(
  quote: StayQuote,
): Pick<
  Prisma.BookingUncheckedCreateInput,
  "amountCents" | "currency" | "nights"
> {
  if (quote.amountCents > MAX_CHARGE) {
    throw new StayTooExpensiveError(quote.amountCents);
  }

  if (quote.amountCents < MIN_CHARGE) {
    throw new StayTooCheapError(quote.amountCents);
  }

  return {
    amountCents: quote.amountCents,
    currency: CURRENCY,
    nights: {
      create: quote.nights.map((night) => ({
        date: new Date(night.date),
        priceCents: night.priceCents,
      })),
    },
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
    guestId: row.guestId,
    listingOwnerId: row.listing.ownerId,
    paymentId: row.paymentIntentId,
  };
}
