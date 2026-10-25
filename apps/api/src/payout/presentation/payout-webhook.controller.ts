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
 * Thin events about hosts' accounts: another format, to a destination of its own with its
 * own secret, into the same inbox. Public, unthrottled and out of `/docs` for the reasons
 * `PaymentWebhookController` states.
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
