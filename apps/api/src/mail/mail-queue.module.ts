import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { requireRedisUrl } from "../common/redis-url";
import type { QueuedMail } from "./application/mail-task";
import {
  MAIL_ENQUEUE_TIMEOUT_MS,
  MAIL_PRODUCER,
  MailQueue,
} from "./infrastructure/mail.queue";

@Module({
  imports: [BullModule.registerQueue({ name: "mail" })],
  providers: [
    MailQueue,
    {
      provide: MAIL_PRODUCER,
      // Nest passes the registered queue's connection options to its worker.
      // The outbox relay can retry disconnected commands from Postgres.
      useFactory: () =>
        new Queue<QueuedMail>("mail", {
          skipWaitingForReady: true,
          skipVersionCheck: true,
          skipMetasUpdate: true,
          connection: {
            url: requireRedisUrl(),
            enableOfflineQueue: false,
            maxRetriesPerRequest: 0,
            commandTimeout: MAIL_ENQUEUE_TIMEOUT_MS,
          },
        }),
    },
  ],
  exports: [MailQueue],
})
export class MailQueueModule {}
