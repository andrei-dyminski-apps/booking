import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { BookingModule } from "../booking/booking.module";
import { NotificationModule } from "../notification/notification.module";
import { PaymentModule } from "../payment/payment.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PayoutEventHandler } from "./application/payout-event-handler";
import { PayoutService } from "./application/payout.service";
import { PayoutGateway } from "./application/ports/payout-gateway";
import { PayoutJobs } from "./application/ports/payout-jobs";
import { HostPayoutProcessor } from "./infrastructure/host-payout.processor";
import {
  HOST_PAYOUT_QUEUE,
  HostPayoutQueue,
} from "./infrastructure/host-payout.queue";
import { PayoutRepository } from "./infrastructure/payout.repository";
import { StripePayoutGateway } from "./infrastructure/stripe-payout.gateway";
import { PayoutAccountController } from "./presentation/payout-account.controller";
import { PayoutWebhookController } from "./presentation/payout-webhook.controller";

/**
 * The host's half of the money. It follows `booking` and `payment` — the stays it pays for,
 * the refunds and disputes that change its share — and neither of them imports it: it plugs
 * in through `PayoutEventHandler`, which registers with the payment dispatcher and with the
 * stay lifecycle when the module starts.
 */
@Module({
  imports: [
    PrismaModule,
    BookingModule,
    PaymentModule,
    // A host hears about a payout sent and a payment disputed.
    NotificationModule,
    BullModule.registerQueue({ name: HOST_PAYOUT_QUEUE }),
  ],
  controllers: [PayoutAccountController, PayoutWebhookController],
  providers: [
    PayoutService,
    PayoutRepository,
    PayoutEventHandler,
    // The host's half of the provider, a port of its own beside `PaymentGateway`.
    { provide: PayoutGateway, useClass: StripePayoutGateway },
    HostPayoutQueue,
    { provide: PayoutJobs, useExisting: HostPayoutQueue },
    HostPayoutProcessor,
  ],
})
export class PayoutModule {}
