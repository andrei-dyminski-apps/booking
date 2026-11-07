import { Test } from "@nestjs/testing";
import { NotificationService } from "../../../notification/notification.service";
import { FakeNotificationService } from "../../../notification/testing/notification-service.fakes";
import { PaymentEventDispatcher } from "../../../payment/application/payment-event-dispatcher";
import { PaymentGateway } from "../../../payment/application/ports/payment-gateway";
import { WaitlistService } from "../../../waitlist/waitlist.service";
import { BookingCancellationRepository } from "../../infrastructure/booking-cancellation.repository";
import { BookingRefundRepository } from "../../infrastructure/booking-refund.repository";
import { BookingRepository } from "../../infrastructure/booking.repository";
import { RefundFailureRepository } from "../../infrastructure/refund-failure.repository";
import { BookingCancellationService } from "../booking-cancellation.service";
import { BookingPaymentHandler } from "../booking-payment.handler";
import { BookingRefundService } from "../booking-refund.service";
import { BookingService } from "../booking.service";
import { BookingJobs } from "../ports/booking-jobs";
import { StayEvents } from "../stay-events";
import { FakeBookingCancellationRepository } from "./booking-cancellation-repository.fakes";
import {
  AMOUNT,
  fromToday,
  guest,
  GUEST_ID,
  LISTING_ID,
} from "./booking-fixtures.fakes";
import { FakeBookingJobs } from "./booking-jobs.fakes";
import { FakeBookingRefundRepository } from "./booking-refund-repository.fakes";
import { FakeBookingRepository } from "./booking-repository.fakes";
import { FakeBookingTable } from "./booking-table.fakes";
import { FakePaymentGateway } from "./payment-gateway.fakes";
import { FakeRefundFailureRepository } from "./refund-failure-repository.fakes";
import { FakeStayEventsListener } from "./stay-events.fakes";
import { FakeWaitlistService } from "./waitlist-service.fakes";

/*
 * The module `booking.service.spec.ts`, `booking-cancellation.service.spec.ts`,
 * `booking-refund.service.spec.ts` and `booking-payment.handler.spec.ts` build their classes
 * in — one module, because the handler's news, the cancellations and their refunds act on
 * the same rows. The fixtures and the fakes of everything around the four classes are the
 * files beside this one, one per port — the notifications' is `notification/testing/`'s,
 * shared with the payout specs; the three repository fakes share one `FakeBookingTable`.
 * Kept out of the build by `tsconfig.build.json` (`*.fakes.ts`).
 */

/** The booking module over the fakes, as the specs build it before each test. */
export type BookingTestbed = {
  service: BookingService;
  cancellationService: BookingCancellationService;
  refundService: BookingRefundService;
  paymentHandler: BookingPaymentHandler;
  bookingTable: FakeBookingTable;
  bookingRepository: FakeBookingRepository;
  bookingCancellationRepository: FakeBookingCancellationRepository;
  bookingRefundRepository: FakeBookingRefundRepository;
  bookingJobs: FakeBookingJobs;
  notificationService: FakeNotificationService;
  refundFailureRepository: FakeRefundFailureRepository;
  waitlistService: FakeWaitlistService;
  paymentGateway: FakePaymentGateway;
  stayEventsListener: FakeStayEventsListener;
};

/** The refund job's worker runs at once, and the stay listener is registered. */
export async function createBookingTestbed(): Promise<BookingTestbed> {
  const bookingTable = new FakeBookingTable();
  const bookingRepository = new FakeBookingRepository(bookingTable);
  const bookingCancellationRepository = new FakeBookingCancellationRepository(
    bookingTable,
  );
  const bookingRefundRepository = new FakeBookingRefundRepository(bookingTable);
  const bookingJobs = new FakeBookingJobs();
  const notificationService = new FakeNotificationService();
  const refundFailureRepository = new FakeRefundFailureRepository();
  const waitlistService = new FakeWaitlistService();
  const paymentGateway = new FakePaymentGateway();
  const stayEventsListener = new FakeStayEventsListener(bookingRepository);

  const moduleRef = await Test.createTestingModule({
    providers: [
      BookingService,
      BookingCancellationService,
      BookingRefundService,
      { provide: BookingRepository, useValue: bookingRepository },
      {
        provide: BookingCancellationRepository,
        useValue: bookingCancellationRepository,
      },
      { provide: BookingRefundRepository, useValue: bookingRefundRepository },
      {
        provide: RefundFailureRepository,
        useValue: refundFailureRepository,
      },
      { provide: BookingJobs, useValue: bookingJobs },
      { provide: NotificationService, useValue: notificationService },
      { provide: WaitlistService, useValue: waitlistService },
      { provide: PaymentGateway, useValue: paymentGateway },
      BookingPaymentHandler,
      StayEvents,
      // The ledger and the dispatching are `payment-event-dispatcher.spec.ts`'s.
      { provide: PaymentEventDispatcher, useValue: { register: () => {} } },
    ],
  }).compile();

  const refundService = moduleRef.get(BookingRefundService);

  bookingJobs.worker = (bookingId) =>
    refundService.refundCancellation(bookingId);
  moduleRef.get(StayEvents).register(stayEventsListener);

  return {
    service: moduleRef.get(BookingService),
    cancellationService: moduleRef.get(BookingCancellationService),
    refundService,
    paymentHandler: moduleRef.get(BookingPaymentHandler),
    bookingTable,
    bookingRepository,
    bookingCancellationRepository,
    bookingRefundRepository,
    bookingJobs,
    notificationService,
    refundFailureRepository,
    waitlistService,
    paymentGateway,
    stayEventsListener,
  };
}

/** A stay `guest` has paid for, starting `days` from today, its payment's news handled. */
export async function payForStay(
  {
    service,
    paymentHandler,
  }: Pick<BookingTestbed, "service" | "paymentHandler">,
  days: number,
): Promise<string> {
  const id = (
    await service.create(GUEST_ID, {
      listingId: LISTING_ID,
      from: fromToday(days),
      to: fromToday(days + 3),
    })
  ).id;
  const { clientSecret } = await service.payment(id, guest);

  await paymentHandler.handle({
    kind: "succeeded",
    eventId: `evt_${id}`,
    type: "payment_intent.succeeded",
    paymentId: clientSecret.replace("_secret", ""),
    chargeId: `ch_${id}`,
    bookingId: id,
    amount: AMOUNT,
  });

  return id;
}
