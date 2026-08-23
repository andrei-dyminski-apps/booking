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
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Role, type Booking } from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import { BookingService } from "./booking.service";
import { BookingDto, CreateBookingDto } from "./dto/booking.dto";

/**
 * Only the reading routes are open to every role, and what they return is narrowed by that
 * role inside the service rather than here — a scope is not something a guard can express.
 */
@Controller("bookings")
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Get()
  @ApiOkResponse({ type: BookingDto, isArray: true })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<Booking[]> {
    return this.bookingService.findAll(user);
  }

  @Get(":id")
  @ApiOkResponse({ type: BookingDto })
  @ApiNotFoundResponse({
    description: "The booking does not exist, or the caller may not read it",
    type: ApiErrorDto,
  })
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Booking> {
    return this.bookingService.findOne(id, user);
  }

  /** Guests book. An owner rents their listings out, an admin moderates — neither books. */
  @Post()
  @Roles(Role.USER)
  @ApiCreatedResponse({ type: BookingDto })
  @ApiNotFoundResponse({
    description: "The listing does not exist",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: "The listing is already booked for an overlapping date range",
    type: ApiErrorDto,
  })
  // Not the 401 of the global guard, which every route answers: this one comes from the
  // service, for a token whose account was deleted while the token was still valid.
  @ApiUnauthorizedResponse({
    description: "The account behind the token no longer exists",
    type: ApiErrorDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBookingDto,
  ): Promise<Booking> {
    return this.bookingService.create(user.id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiForbiddenResponse({
    description: "The booking exists but was not made by the caller",
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: "The booking does not exist, or the caller may not read it",
    type: ApiErrorDto,
  })
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.bookingService.remove(id, user);
  }
}
