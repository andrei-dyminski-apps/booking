import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { StayNotice } from "@repo/contracts";
import {
  StayLifecycle,
  type StayListener,
} from "../../booking/application/stay-lifecycle";
import { PaymentEventDispatcher } from "../../payment/application/payment-event-dispatcher";
import type { PaymentEventHandler } from "../../payment/application/payment-event-handler";
import type { PaymentEvent } from "../../payment/application/ports/payment-gateway";
import { PayoutService } from "./payout.service";

/**
 * Where the payout side plugs into the other two. From the payment provider it takes the
 * disputes and the news about hosts' accounts, and from the stays it takes the moments a host's share is decided at: a stay
 * confirmed (its payout is scheduled) and a refund recorded (the host's part of it is taken
 * back) — whether the cancellation issued it or somebody did from Stripe's dashboard.
 */
@Injectable()
export class PayoutEventHandler
  implements PaymentEventHandler, StayListener, OnModuleInit
{
  constructor(
    private readonly payoutService: PayoutService,
    private readonly paymentEventDispatcher: PaymentEventDispatcher,
    private readonly stayLifecycle: StayLifecycle,
  ) {}

  onModuleInit(): void {
    this.paymentEventDispatcher.register(this);
    this.stayLifecycle.register(this);
  }

  async handle(event: PaymentEvent): Promise<void> {
    switch (event.kind) {
      case "disputed":
      case "disputeClosed":
        await this.payoutService.handleSettlementEvent(event);
        break;
      case "account":
        await this.payoutService.handleAccountEvent(event);
        break;
      // A refund reaches this side through `StayLifecycle`, once the stay has recorded it.
      case "succeeded":
      case "refunded":
      case "refundFailed":
      case "other":
        break;
    }
  }

  confirmed(stay: StayNotice): Promise<void> {
    return this.payoutService.schedule(stay);
  }

  async refunded(bookingId: string): Promise<void> {
    await this.payoutService.settle(bookingId);
  }
}
