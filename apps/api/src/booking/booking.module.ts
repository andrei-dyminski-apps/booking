import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { BookingController } from "./booking.controller";
import { BookingRepository } from "./booking.repository";
import { BookingService } from "./booking.service";
import { BookingExpiryProcessor } from "./booking-expiry.processor";
import {
  BOOKING_EXPIRY_QUEUE,
  BookingExpiryQueue,
} from "./booking-expiry.queue";

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: BOOKING_EXPIRY_QUEUE }),
  ],
  controllers: [BookingController],
  providers: [
    BookingService,
    BookingRepository,
    BookingExpiryQueue,
    BookingExpiryProcessor,
  ],
  // ListingService reads the availability of a listing through it — the stays are booking
  // rows, so the query and their date mapping stay on this side of the wall.
  exports: [BookingRepository],
})
export class BookingModule {}
