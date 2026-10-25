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
import { PaymentEventDispatcher } from "../application/payment-event-dispatcher";
import {
  InvalidPaymentEventError,
  PaymentGateway,
  type PaymentEvent,
} from "../application/ports/payment-gateway";

/**
 * The source of truth for whether a stay is paid — the guest's redirect is a URL anybody
 * can type. `@Public()` because the signature over the raw body stands in for a session;
 * unthrottled because the provider retries from shared addresses; out of `/docs` because
 * its contract is the provider's event format.
 */
@Controller("payments")
export class PaymentWebhookController {
  constructor(
    private readonly paymentEventDispatcher: PaymentEventDispatcher,
    private readonly paymentGateway: PaymentGateway,
  ) {}

  /** A `500` when the event could not be recorded, which the provider answers by redelivering. */
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

    let event: PaymentEvent;

    try {
      event = this.paymentGateway.readEvent(request.rawBody, signature);
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
