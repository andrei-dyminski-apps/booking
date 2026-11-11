import type { CreateBookingInput } from "@repo/contracts";
import { RetryLaterError } from "../../common/retry-later.error";
import {
  formatCents,
  MAX_CHARGE,
  MIN_CHARGE,
  type Cents,
} from "../../payment/domain/money";

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

/**
 * The listing has been saved since the version the request says the guest was shown, so
 * its prices or its cancellation policy may not be the ones they read. Read off the same
 * locked row the hold is priced and copies its policy from, so a host's save either lands
 * before this check or waits for the hold.
 */
export class ListingChangedError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} has changed since it was shown`);
    this.name = "ListingChangedError";
  }
}

/**
 * The request asked for the non-refundable rate on a listing that does not offer one. Read
 * off the same locked row as the discount it would have taken, so a host withdrawing the
 * rate either lands before this check or waits for the hold.
 */
export class RateNotOfferedError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} offers no non-refundable rate`);
    this.name = "RateNotOfferedError";
  }
}

/**
 * A quote one payment cannot carry. Raised under the lock once the quote exists, so nothing
 * is inserted; `refusal` is `chargeRefusal`'s answer, so the bounds and the words the
 * service refuses the hold with are the contract's — the ones the booking form shows.
 */
export class UnchargeableStayError extends Error {
  constructor(
    amount: Cents,
    readonly refusal: string,
  ) {
    super(
      `A stay costing ${formatCents(amount)} is outside what one payment can carry (${formatCents(MIN_CHARGE)} to ${formatCents(MAX_CHARGE)})`,
    );
    this.name = "UnchargeableStayError";
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
