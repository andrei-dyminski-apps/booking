import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { Queue } from "bullmq";
import { requireRedisUrl } from "../common/redis-url";
import { PrismaModule } from "../prisma/prisma.module";
import { PushDispatcher } from "./application/push-dispatcher";
import { PushService } from "./application/push.service";
import { PushGateway } from "./application/ports/push-gateway";
import {
  PUSH_QUEUE,
  PushJobs,
  type PushJob,
} from "./application/ports/push-jobs";
import { PushOutboxRelay } from "./infrastructure/push-outbox.relay";
import { PushOutboxRepository } from "./infrastructure/push-outbox.repository";
import { PushProcessor } from "./infrastructure/push.processor";
import {
  PUSH_ENQUEUE_TIMEOUT_MS,
  PUSH_PRODUCER,
  PushQueue,
} from "./infrastructure/push.queue";
import { PushRepository } from "./infrastructure/push.repository";
import { pushGateway } from "./infrastructure/web-push.gateway";
import { PushController } from "./presentation/push.controller";

/**
 * Exports nothing: the notices and the messages reach push through `recordPushTask` inside
 * their own transactions, the way they reach the mail outbox, not through a provider.
 */
@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: PUSH_QUEUE })],
  controllers: [PushController],
  providers: [
    PushService,
    PushDispatcher,
    PushRepository,
    PushOutboxRepository,
    PushOutboxRelay,
    PushProcessor,
    {
      provide: PUSH_PRODUCER,
      // The relay can recover from Postgres. Never buffer or replay its Redis writes.
      useFactory: () =>
        new Queue<PushJob>(PUSH_QUEUE, {
          skipWaitingForReady: true,
          skipVersionCheck: true,
          skipMetasUpdate: true,
          connection: {
            url: requireRedisUrl(),
            enableOfflineQueue: false,
            autoResendUnfulfilledCommands: false,
            maxRetriesPerRequest: 0,
            commandTimeout: PUSH_ENQUEUE_TIMEOUT_MS,
          },
        }),
    },
    { provide: PushJobs, useClass: PushQueue },
    { provide: PushGateway, useFactory: pushGateway },
  ],
})
export class PushModule {}
