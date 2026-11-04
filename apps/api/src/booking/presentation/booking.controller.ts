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
  ApiBadGatewayResponse,
  ApiBody,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPreconditionFailedResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import {
  Role,
  type Booking,
  type BookingDetail,
  type BookingPage,
  type BookingPayment,
  type StuckStayPage,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../../common/dto/api-error.dto";
import { BookingService } from "../application/booking.service";
import {
  BookingDetailDto,
  BookingDto,
  BookingPageDto,
  BookingPaymentDto,
  BookingQueryDto,
  CancelBookingDto,
  CreateBookingDto,
  StuckStayPageDto,
  StuckStayQueryDto,
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

  /**
   * The stays whose owed refund or host payout stopped retrying. Declared before `:id`,
   * which would otherwise take `stuck` for an id and refuse it as no uuid.
   */
  @Get("stuck")
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: StuckStayPageDto })
  @ApiBadRequestResponse({
    description:
      "The cursor was not issued by this list, or was issued under the other `kind`",
    type: ApiErrorDto,
  })
  findStuck(@Query() query: StuckStayQueryDto): Promise<StuckStayPage> {
    return this.bookingService.findStuckPage(query);
  }

  /**
   * The refund half of `POST /bookings/:id/stuck/:kind/retry`; the payout half is
   * `StuckPayoutController`'s, since only the payout module may send a transfer.
   */
  @Post(":id/stuck/refund/retry")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    description: "The booking does not exist",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: "The booking owes no refund that was set aside",
    type: ApiErrorDto,
  })
  retryStuckRefund(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.bookingService.retryStuckRefund(id);
  }

  @Get(":id")
  @ApiOkResponse({ type: BookingDetailDto })
  @ApiNotFoundResponse({
    description: "The booking does not exist, or the caller may not read it",
    type: ApiErrorDto,
  })
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BookingDetail> {
    return this.bookingService.findOne(id, user);
  }

  /**
   * What the guest pays for their hold with: the secret Stripe Elements confirms the
   * PaymentIntent with in the browser. A `POST`, because the first call opens the intent at
   * Stripe and records it; every call after it answers the same one, so the request is safe
   * to repeat. Whether the stay is then paid is not this route's to say — the webhook
   * confirms it, and the page polls `GET /bookings/:id`.
   */
  @Post(":id/payment")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER)
  @ApiOkResponse({ type: BookingPaymentDto })
  @ApiNotFoundResponse({
    description: "The booking does not exist, or the caller may not read it",
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: "The caller may read the booking but is not its guest",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      "The booking is not waiting for payment — paid, cancelled, or its hold has lapsed — or another request is opening its payment right now, which a retry answers",
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: "The payment provider could not be reached",
    type: ApiErrorDto,
  })
  payment(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BookingPayment> {
    return this.bookingService.payment(id, user);
  }

  /**
   * Any user books — a host too, though not their own listing (`403`). An admin moderates
   * and does not book.
   */
  @Post()
  @Roles(Role.USER)
  @ApiCreatedResponse({ type: BookingDto })
  @ApiNotFoundResponse({
    description: "The listing does not exist",
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: "The listing is the caller's own",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: "The listing is already booked for an overlapping date range",
    type: ApiErrorDto,
  })
  @ApiPreconditionFailedResponse({
    description:
      "The listing has been saved since the version the request names (`listingUpdatedAt`)",
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

  /**
   * Cancelled when it answers; a refund the cancellation owes is sent after it, by a job,
   * and the booking says so in `refundOwedCents` until it has gone out. The guest, the host
   * of the listing and an admin may cancel; a host has to give a `reason`, refunds the guest
   * in full and owes a fee for a paid stay. The body is optional — a client with nothing to
   * say sends none.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBody({ type: CancelBookingDto, required: false })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: "The host of the listing cancels without a reason",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      "The stay has begun, its payment is disputed, it was paid for while being cancelled, or another cancellation holds it",
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: "The booking does not exist, or the caller may not read it",
    type: ApiErrorDto,
  })
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CancelBookingDto,
  ): Promise<void> {
    return this.bookingService.remove(id, user, dto);
  }
}
