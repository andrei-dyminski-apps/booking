import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { BookingController } from "./booking.controller";
import { BookingRepository } from "./booking.repository";
import { BookingService } from "./booking.service";

@Module({
  imports: [PrismaModule],
  controllers: [BookingController],
  providers: [BookingService, BookingRepository],
})
export class BookingModule {}
