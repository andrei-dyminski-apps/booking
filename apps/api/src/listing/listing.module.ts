import { Module } from "@nestjs/common";
import { BookingModule } from "../booking/booking.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ListingController } from "./listing.controller";
import { ListingRepository } from "./listing.repository";
import { ListingService } from "./listing.service";

@Module({
  // BookingModule for its repository alone: the availability of a listing is read from the
  // bookings against it, and that query belongs to the repository that owns those rows.
  imports: [PrismaModule, BookingModule],
  controllers: [ListingController],
  providers: [ListingService, ListingRepository],
  // ReviewService asks it whether a listing is still offered before answering for its
  // reviews — "still offered" is `STILL_OFFERED`, and this class is where it is spelled.
  exports: [ListingRepository],
})
export class ListingModule {}
