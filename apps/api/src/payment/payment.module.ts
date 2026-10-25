import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { NotificationModule } from "../notification/notification.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PaymentEventDispatcher } from "./application/payment-event-dispatcher";
import { PaymentEventJobs } from "./application/ports/payment-event-jobs";
import { PaymentGateway } from "./application/ports/payment-gateway";
import { PaymentEventProcessor } from "./infrastructure/payment-event.processor";
import {
  PAYMENT_EVENT_QUEUE,
  PaymentEventQueue,
} from "./infrastructure/payment-event.queue";
import { PaymentEventRepository } from "./infrastructure/payment-event.repository";
import {
  loadPaymentConfig,
  PAYMENT_CONFIG,
} from "./infrastructure/payment.config";
import { StripePaymentGateway } from "./infrastructure/stripe-payment.gateway";
import { PaymentWebhookController } from "./presentation/payment-webhook.controller";

/**
 * The guest's half of the money and the provider's front door: the gateway over Stripe, the
 * inbox of webhook deliveries and the worker that handles them. It knows no
 * stay — `booking` and `payout` depend on it, never the other way round, and register the
 * handlers of what they own with the dispatcher.
 */
@Module({
  imports: [
    PrismaModule,
    // The admins hear about an event the worker set aside.
    NotificationModule,
    BullModule.registerQueue({ name: PAYMENT_EVENT_QUEUE }),
  ],
  controllers: [PaymentWebhookController],
  providers: [
    PaymentEventRepository,
    PaymentEventDispatcher,
    PaymentEventQueue,
    { provide: PaymentEventJobs, useExisting: PaymentEventQueue },
    PaymentEventProcessor,
    { provide: PAYMENT_CONFIG, useFactory: loadPaymentConfig },
    // The port and its one adapter: a service names `PaymentGateway`, and a test swaps what
    // stands behind it with `overrideProvider(PaymentGateway)`.
    { provide: PaymentGateway, useClass: StripePaymentGateway },
  ],
  exports: [PaymentGateway, PaymentEventDispatcher, PAYMENT_CONFIG],
})
export class PaymentModule {}
