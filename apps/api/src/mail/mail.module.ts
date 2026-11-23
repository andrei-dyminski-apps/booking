import { Module } from "@nestjs/common";
import { ConversationModule } from "../conversation/conversation.module";
import { PrismaModule } from "../prisma/prisma.module";
import { MailDeliveryService } from "./application/mail-delivery.service";
import { MailQueueModule } from "./mail-queue.module";
import { MailGateway } from "./application/ports/mail-gateway";
import { mailGateway } from "./infrastructure/mail-gateways";
import { MailRepository } from "./infrastructure/mail.repository";
import { MailProcessor } from "./infrastructure/mail.processor";
import { MailController } from "./presentation/mail.controller";
import { MailWebhookController } from "./presentation/mail-webhook.controller";
import { MailInbox } from "./application/mail-inbox";
import { MailService } from "./application/mail.service";
import { MailOutboxRepository } from "./infrastructure/mail-outbox.repository";
import { MailOutboxRelay } from "./infrastructure/mail-outbox.relay";

@Module({
  imports: [ConversationModule, PrismaModule, MailQueueModule],
  providers: [
    MailRepository,
    MailService,
    MailDeliveryService,
    MailProcessor,
    MailInbox,
    MailOutboxRepository,
    MailOutboxRelay,
    { provide: MailGateway, useFactory: mailGateway },
  ],
  controllers: [MailController, MailWebhookController],
})
export class MailModule {}
