import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from "@nestjs/swagger";
import { Role, type FailedPaymentEventPage } from "@repo/contracts";
import { Roles } from "../../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../../common/dto/api-error.dto";
import { PaymentEventDispatcher } from "../application/payment-event-dispatcher";
import {
  FailedPaymentEventPageDto,
  FailedPaymentEventQueryDto,
} from "./dto/payment-event.dto";

/**
 * The inbox as an admin sees it: the events its worker gave up on, and the way to hand one
 * back. The admin's alone, stated once on the class for the reason `UserController` gives.
 */
@Controller("payment-events")
@Roles(Role.ADMIN)
export class PaymentEventController {
  constructor(
    private readonly paymentEventDispatcher: PaymentEventDispatcher,
  ) {}

  @Get("failed")
  @ApiOkResponse({ type: FailedPaymentEventPageDto })
  @ApiBadRequestResponse({
    description: "The cursor was not issued by this list",
    type: ApiErrorDto,
  })
  failed(
    @Query() query: FailedPaymentEventQueryDto,
  ): Promise<FailedPaymentEventPage> {
    return this.paymentEventDispatcher.failedPage(query);
  }

  /** Queued at once; the worker runs it with a whole count of attempts again. */
  @Post(":id/retry")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    description: "No event with this id was received",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      "The event is not set aside: processed, or still being retried",
    type: ApiErrorDto,
  })
  retry(@Param("id") id: string): Promise<void> {
    return this.paymentEventDispatcher.retry(id);
  }
}
