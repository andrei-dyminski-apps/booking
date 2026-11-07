import type { Cents } from "../../../payment/domain/money";
import type { StayEventsListener } from "../stay-events";
import type { FakeBookingRepository } from "./booking-repository.fakes";

/**
 * Whoever follows the stays, as far as the booking side cares: the stays it confirmed and
 * the refunds it announced. What a payout side does with them is `payout.service.spec.ts`'s.
 */
export class FakeStayEventsListener implements Required<StayEventsListener> {
  readonly scheduled: string[] = [];

  /** Each refund announced, with the refund total the stay recorded by then. */
  readonly settled: { bookingId: string; refunded: Cents | null }[] = [];

  constructor(
    private readonly bookingRepository: Pick<
      FakeBookingRepository,
      "findByIdWithListingOwner"
    >,
  ) {}

  /** Set to have taking back a payout fail, as a provider that cannot be reached would. */
  refusing = false;

  /** Set to have the next payout fail to be scheduled, as a Redis that is down would. */
  refusingSchedule = false;

  confirmed(stay: { bookingId: string }): Promise<void> {
    if (this.refusingSchedule) {
      this.refusingSchedule = false;

      return Promise.reject(new Error("connect ECONNREFUSED"));
    }

    this.scheduled.push(stay.bookingId);

    return Promise.resolve();
  }

  async refunded(bookingId: string): Promise<void> {
    if (this.refusing) throw new Error("api_connection_error");

    const found =
      await this.bookingRepository.findByIdWithListingOwner(bookingId);

    this.settled.push({
      bookingId,
      refunded: found?.booking.refundedAmountCents ?? null,
    });
  }
}
