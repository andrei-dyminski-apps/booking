import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { StayNotice } from "@repo/contracts";
import {
  StayLifecycle,
  type StayListener,
} from "../../booking/application/stay-lifecycle";
import { PaymentEventDispatcher } from "../../payment/application/payment-event-dispatcher";
import {
  PaymentEventBusyError,
  type PaymentEventHandler,
} from "../../payment/application/payment-event-handler";
import type { PaymentEvent } from "../../payment/application/ports/payment-gateway";
import { SettlementInProgressError } from "../domain/payout.errors";
import { PayoutService } from "./payout.service";

/**
 * Where payout plugs into the other two: disputes and account news from the provider, and
 * from the stays a confirmation (the payout is scheduled) and a refund (it is settled).
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

  handle(event: PaymentEvent): Promise<void> {
    return busyAsRetry(async () => {
      switch (event.kind) {
        case "disputed":
        case "disputeClosed":
          await this.payoutService.handleSettlementEvent(event);
          break;
        case "account":
          await this.payoutService.handleAccountEvent(event);
          break;
        case "succeeded":
        case "refunded":
        case "refundFailed":
        case "other":
          break;
      }
    });
  }

  confirmed(stay: StayNotice): Promise<void> {
    return this.payoutService.schedule(stay);
  }

  /** Reached from the refund's event too, which retries a busy settlement uncounted. */
  refunded(bookingId: string): Promise<void> {
    return busyAsRetry(async () => {
      await this.payoutService.settle(bookingId);
    });
  }
}

/** A settlement another run holds, as the inbox's retry that counts no failure. */
async function busyAsRetry(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (error instanceof SettlementInProgressError) {
      throw new PaymentEventBusyError(error.message);
    }

    throw error;
  }
}
