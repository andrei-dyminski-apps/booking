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
import { StuckPayoutController } from "./presentation/stuck-payout.controller";

/** Nothing imports it: `PayoutEventHandler` registers with the dispatcher and `StayEvents`. */
@Module({
  imports: [
    PrismaModule,
    BookingModule,
    PaymentModule,
    NotificationModule,
    BullModule.registerQueue({ name: HOST_PAYOUT_QUEUE }),
  ],
  controllers: [
    PayoutAccountController,
    PayoutWebhookController,
    StuckPayoutController,
  ],
  providers: [
    PayoutService,
    PayoutRepository,
    PayoutEventHandler,
    { provide: PayoutGateway, useClass: StripePayoutGateway },
    { provide: PayoutJobs, useClass: HostPayoutQueue },
    HostPayoutProcessor,
  ],
})
export class PayoutModule {}
