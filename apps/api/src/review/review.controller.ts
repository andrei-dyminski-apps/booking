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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Role, type Review, type ReviewPage } from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import { CATALOGUE_READS } from "../common/throttle";
import {
  CreateReviewDto,
  ReviewDto,
  ReviewPageDto,
  ReviewQueryDto,
} from "./dto/review.dto";
import { ReviewService } from "./review.service";

const STALE_CURSOR =
  "The cursor was not issued by this list, or was issued under a different `sort`: a cursor names a place in one ordering, so changing the ordering starts the pages again";

/**
 * Reviews hang off the resources they are about — a listing, a guest, a stay — so the
 * controller has no prefix of its own and each route names its parent. The one route of
 * its own is the admin's removal, which needs nothing but the review.
 */
@Controller()
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  /**
   * Public and widened like the catalogue's reads, and for their reason: the frontend
   * caches it beside `GET /listings/:id`, so it arrives from that server's one address
   * rather than from a visitor's — see `CATALOGUE_READS`.
   */
  @Get("listings/:id/reviews")
  @Public()
  @Throttle(CATALOGUE_READS)
  @ApiOkResponse({ type: ReviewPageDto })
  @ApiBadRequestResponse({ description: STALE_CURSOR, type: ApiErrorDto })
  @ApiNotFoundResponse({
    description: "The listing does not exist, or has been retired",
    type: ApiErrorDto,
  })
  findForListing(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ReviewQueryDto,
  ): Promise<ReviewPage> {
    return this.reviewService.findListingPage(id, query);
  }

  @Get("guests/:id/reviews")
  @ApiOkResponse({ type: ReviewPageDto })
  @ApiBadRequestResponse({ description: STALE_CURSOR, type: ApiErrorDto })
  @ApiNotFoundResponse({
    description:
      "The caller may not read this guest's reviews: only the guest, an admin and the hosts the guest has booked with may",
    type: ApiErrorDto,
  })
  findForGuest(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReviewQueryDto,
  ): Promise<ReviewPage> {
    return this.reviewService.findGuestPage(id, user, query);
  }

  /** The guest reviews the listing, its owner reviews the guest — an admin writes neither. */
  @Post("bookings/:id/reviews")
  @Roles(Role.USER)
  @ApiCreatedResponse({ type: ReviewDto })
  @ApiNotFoundResponse({
    description:
      "The booking does not exist, or the caller is neither its guest nor the owner of its listing",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      "The stay is not confirmed or not over yet, or the caller has already reviewed it",
    type: ApiErrorDto,
  })
  create(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReviewDto,
  ): Promise<Review> {
    return this.reviewService.create(id, user, dto);
  }

  @Delete("reviews/:id")
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    description: "The review does not exist, or was already removed",
    type: ApiErrorDto,
  })
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.reviewService.remove(id);
  }
}
