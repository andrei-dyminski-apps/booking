import { Module } from "@nestjs/common";
import { BookingModule } from "../booking/booking.module";
import { ListingModule } from "../listing/listing.module";
import { NotificationModule } from "../notification/notification.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ReviewController } from "./review.controller";
import { ReviewRepository } from "./review.repository";
import { ReviewService } from "./review.service";

@Module({
  // BookingModule for the stay a review is written against and for whether a guest has
  // asked to stay with a host; ListingModule for whether a listing is still offered. Both
  // are questions about rows those repositories own. NotificationModule to tell the side
  // of the stay a review is about.
  imports: [PrismaModule, BookingModule, ListingModule, NotificationModule],
  controllers: [ReviewController],
  providers: [ReviewService, ReviewRepository],
})
export class ReviewModule {}
