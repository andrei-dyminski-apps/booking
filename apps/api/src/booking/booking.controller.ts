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
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Role, type Booking, type BookingPage } from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import { BookingService } from "./booking.service";
import {
  BookingDto,
  BookingPageDto,
  BookingQueryDto,
  CreateBookingDto,
} from "./dto/booking.dto";

/**
 * Only the reading routes are open to every role, and what they return is narrowed by that
 * role inside the service rather than here — a scope is not something a guard can express.
 */
@Controller("bookings")
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  /**
   * One page of the stays this caller may see. The filters, the ordering and the cursor
   * arrive in the query string rather than in a body for the reason the catalogue's do:
   * that is what makes a search a link somebody can send, and what lets the frontend keep
   * them in `searchParams`.
   *
   * Paged because one of the three scopes has no ceiling: an admin's list is every stay on
   * the site, and answering it whole was a query that grew with the site and a response the
   * frontend had to parse and draw in one go.
   */
  @Get()
  @ApiOkResponse({ type: BookingPageDto })
  @ApiBadRequestResponse({
    description:
      "The cursor was not issued by this API, or was issued under a different `sort`: a cursor names a place in one ordering, so changing the ordering starts the pages again",
    type: ApiErrorDto,
  })
  findPage(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: BookingQueryDto,
  ): Promise<BookingPage> {
    return this.bookingService.findPage(user, query);
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
