import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
} from "@nestjs/swagger";
import { Role } from "@repo/contracts";
import { Roles } from "../../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../../common/dto/api-error.dto";
import { PayoutService } from "../application/payout.service";

/**
 * The payout half of `POST /bookings/:id/stuck/:kind/retry`, beside the refund half in
 * `BookingController`: the path is the stay's, the transfer is this module's, and `booking`
 * may not import it. The list of what is stuck is `GET /bookings/stuck`, for both kinds.
 */
@Controller("bookings")
@Roles(Role.ADMIN)
export class StuckPayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post(":id/stuck/payout/retry")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    description: "The booking does not exist",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      "The booking's payout is not set aside, an open dispute holds it, or a lost dispute or a full refund leaves nothing to send",
    type: ApiErrorDto,
  })
  retry(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.payoutService.retryStuckPayout(id);
  }
}
