import type { CreateBookingInput } from "@repo/contracts";
import { RetryLaterError } from "../../common/retry-later.error";
import { MAX_CHARGE, MIN_CHARGE } from "./stay-price";

/**
 * What `create` throws instead of letting a Prisma error code reach the service. The
 * listing key is now checked under the `FOR UPDATE` lock rather than at the insert, so an
 * insert only reaches this for the guest key — but the translation is kept whole, because
 * `test/booking.repository.e2e-spec.ts` still drives both sides directly.
 */
export class ListingNotFoundError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} not found`);
    this.name = "ListingNotFoundError";
  }
}

/**
 * The other row an insert can fail on, and the one nothing checks beforehand: the guest is
 * whoever the access token names, and `JwtStrategy` reads no database, so an account
 * deleted mid-session keeps minting valid requests for as long as `JWT_ACCESS_TTL`. That
 * is an ended session rather than a missing listing — the service answers it the way
 * `/auth/me` answers a token whose row is gone.
 */
export class GuestNotFoundError extends Error {
  constructor(guestId: string) {
    super(`Guest ${guestId} not found`);
    this.name = "GuestNotFoundError";
  }
}

/**
 * The guest owns the listing they asked to book. Read off the same locked row as the
 * existence check, so it costs no query of its own; the service answers it the way
 * starting a conversation about one's own listing is answered.
 */
export class OwnListingError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} is your own`);
    this.name = "OwnListingError";
  }
}

/**
 * The dates asked for overlap an active stay on that listing. Raised from inside the
 * locking transaction — either by the explicit overlap check or, if a bug slips past it,
 * by the `EXCLUDE` constraint. The service turns both into one `409`.
 */
export class DatesUnavailableError extends Error {
  constructor(input: CreateBookingInput) {
    super(
      `Listing ${input.listingId} is already booked for an overlapping range (${input.from} to ${input.to})`,
    );
    this.name = "DatesUnavailableError";
  }
}

/** Raised under the lock once the quote exists, so nothing is inserted. */
export class StayTooExpensiveError extends Error {
  constructor(amount: number) {
    super(
      `A stay costing ${amount.toFixed(2)} is more than one payment can carry (${MAX_CHARGE.toFixed(2)})`,
    );
    this.name = "StayTooExpensiveError";
  }
}

export class StayTooCheapError extends Error {
  constructor(amount: number) {
    super(
      `A stay costing ${amount.toFixed(2)} is less than one payment can carry (${MIN_CHARGE.toFixed(2)})`,
    );
    this.name = "StayTooCheapError";
  }
}

/**
 * A refund or a dispute of a payment whose own confirmation has not been handled yet — see
 * `awaitsItsPayment`. Thrown so the event is delivered again once it has.
 */
export class PaymentNotConfirmedYetError extends Error {
  constructor(paymentId: string) {
    super(
      `Payment ${paymentId} has not confirmed its hold yet; its news is handled once it has`,
    );
    this.name = "PaymentNotConfirmedYetError";
  }
}

/** A `409` worth retrying to a request, a retry to a job or an event. */
export class CancellationInProgressError extends RetryLaterError {
  constructor(id: string) {
    super(`Booking ${id} is being cancelled by another request`);
    this.name = "CancellationInProgressError";
  }
}
