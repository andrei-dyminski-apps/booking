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
import { Role, type Booking } from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { BookingService } from "./booking.service";
import { CreateBookingDto } from "./dto/booking.dto";

/**
 * Only the reading routes are open to every role, and what they return is narrowed by that
 * role inside the service rather than here — a scope is not something a guard can express.
 */
@Controller("bookings")
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<Booking[]> {
    return this.bookingService.findAll(user);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Booking> {
    return this.bookingService.findOne(id, user);
  }

  /** Guests book. An owner rents their listings out, an admin moderates — neither books. */
  @Post()
  @Roles(Role.USER)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBookingDto,
  ): Promise<Booking> {
    return this.bookingService.create(user.id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.bookingService.remove(id, user);
  }
}
