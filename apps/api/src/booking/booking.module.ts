import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { NotificationModule } from "../notification/notification.module";
import { PaymentModule } from "../payment/payment.module";
import { PrismaModule } from "../prisma/prisma.module";
import { WaitlistModule } from "../waitlist/waitlist.module";
import { BookingController } from "./presentation/booking.controller";
import { BookingRepository } from "./infrastructure/booking.repository";
import { RefundFailureRepository } from "./infrastructure/refund-failure.repository";
import { BookingPaymentHandler } from "./application/booking-payment.handler";
import { BookingService } from "./application/booking.service";
import { BookingJobs } from "./application/ports/booking-jobs";
import { StayLifecycle } from "./application/stay-lifecycle";
import { BookingExpiryProcessor } from "./infrastructure/booking-expiry.processor";
import {
  BOOKING_EXPIRY_QUEUE,
  BookingExpiryQueue,
} from "./infrastructure/booking-expiry.queue";

@Module({
  imports: [
    PrismaModule,
    // The gateway a payment is opened, withdrawn and refunded through, and the dispatcher
    // the handler of a payment's news registers with.
    PaymentModule,
    // The host hears about a hold, both sides about a cancellation and a lapsed hold.
    NotificationModule,
    // Whoever waits for nights a cancellation or a lapsed hold let go of hears about it.
    WaitlistModule,
    BullModule.registerQueue({ name: BOOKING_EXPIRY_QUEUE }),
  ],
  controllers: [BookingController],
  providers: [
    BookingService,
    BookingRepository,
    RefundFailureRepository,
    BookingPaymentHandler,
    StayLifecycle,
    BookingExpiryQueue,
    // The port the service schedules through, and the queue behind it — one instance, so
    // the e2e specs that reach for the queue by its class drive the same one.
    { provide: BookingJobs, useExisting: BookingExpiryQueue },
    BookingExpiryProcessor,
  ],
  // ListingService reads the availability of a listing through it — the stays are booking
  // rows, so the query and their date mapping stay on this side of the wall. `payout`
  // reads the same rows, and listens to the stays through `StayLifecycle`.
  exports: [BookingRepository, StayLifecycle],
})
export class BookingModule {}
