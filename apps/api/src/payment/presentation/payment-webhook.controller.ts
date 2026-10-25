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
 * Where the payment provider tells this API what happened to a payment, and the source of
 * truth for whether a stay is paid — the guest's redirect is a URL anybody can type. This
 * route verifies a delivery and hands it to the inbox (`PaymentEventDispatcher.receive`);
 * what the news means is the registered handlers' to decide, in a worker.
 *
 * `@Public()` because the provider has no session; the signature over the raw body stands
 * in for one, which is why the body parser keeps the bytes of this route (`body-parsers.ts`).
 * Out of the throttle, since the provider retries on its own schedule from shared
 * addresses, and out of `/docs`: its contract is the provider's event format.
 */
@Controller("payments")
export class PaymentWebhookController {
  constructor(
    private readonly paymentEventDispatcher: PaymentEventDispatcher,
    private readonly paymentGateway: PaymentGateway,
  ) {}

  /**
   * `200` once the event is recorded or was already; `400` for one that is not the
   * provider's; a `500` when it could not be recorded, which the provider answers by
   * delivering it again.
   */
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
