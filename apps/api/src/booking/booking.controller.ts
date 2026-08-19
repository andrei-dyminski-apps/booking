import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import type { Booking } from "@repo/contracts";
import { BookingService } from "./booking.service";
import { BookingDto, CreateBookingDto } from "./dto/booking.dto";

@Controller("bookings")
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Get()
  findAll(): Promise<Booking[]> {
    return this.bookingService.findAll();
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<Booking> {
    return this.bookingService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateBookingDto): Promise<BookingDto> {
    return this.bookingService.create(dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.bookingService.remove(id);
  }
}
