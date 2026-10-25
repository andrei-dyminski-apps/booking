import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  type RawBodyRequest,
} from "@nestjs/common";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { Public } from "../../auth/decorators/public.decorator";
import { PaymentEventDispatcher } from "../../payment/application/payment-event-dispatcher";
import { InvalidPaymentEventError } from "../../payment/application/ports/payment-gateway";
import {
  PayoutGateway,
  type AccountEvent,
} from "../application/ports/payout-gateway";

/**
 * The provider's news about connected accounts — the payout accounts of hosts. A delivery of
 * its own because Stripe sends these in another format (a thin event: what changed is read
 * back from the provider, not out of the body) to a destination of its own, signed with that
 * destination's secret. Public, unthrottled and out of `/docs` for the reasons
 * `PaymentWebhookController` states.
 *
 * Verified here and handed to the same inbox as the payment events, so it is answered at
 * once and handled by the worker (`PayoutEventHandler`). `200` once recorded, `400` for one
 * that is not the provider's, `500` when it could not be recorded.
 */
@Controller("payouts")
export class PayoutWebhookController {
  constructor(
    private readonly paymentEventDispatcher: PaymentEventDispatcher,
    private readonly payoutGateway: PayoutGateway,
  ) {}

  @Post("webhook")
  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature: string | undefined,
  ): Promise<{ received: true }> {
    if (request.rawBody === undefined || signature === undefined) {
      throw new BadRequestException("A signed webhook delivery is required");
    }

    let event: AccountEvent;

    try {
      event = this.payoutGateway.readAccountEvent(request.rawBody, signature);
    } catch (error) {
      if (error instanceof InvalidPaymentEventError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }

    await this.paymentEventDispatcher.receive(event);

    return { received: true };
  }
}
