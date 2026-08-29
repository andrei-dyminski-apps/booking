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
})
export class ListingModule {}
