import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from "@nestjs/common";
import type { Queue } from "bullmq";
import { addMinutes, differenceInMilliseconds } from "date-fns";
import { RedisOutage } from "../../common/redis-outage";
import {
  MAIL_SEND_ATTEMPTS,
  mailDeliveryKey,
  type PendingMail,
  type QueuedMail,
} from "../application/mail-task";

export const MAIL_ENQUEUE_TIMEOUT_MS = 1000;
export const MAIL_PRODUCER = Symbol("MAIL_PRODUCER");

@Injectable()
export class MailQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(MailQueue.name);

  constructor(
    @Inject(MAIL_PRODUCER) private readonly queue: Queue<QueuedMail>,
  ) {
    const outage = new RedisOutage(this.logger, "Mail queue");
    queue.on("error", (error) => outage.report(error, queue.getBackend()));
  }
  async onApplicationShutdown() {
    await this.queue.disconnect();
  }
  async schedule(
    task: PendingMail,
  ): Promise<"pending" | "finished" | "unavailable"> {
    const key = mailDeliveryKey(task);
    const jobId = task.deliveryRound
      ? key + "-" + String(task.deliveryRound)
      : key;
    let deadline: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.ensureQueued(task, jobId),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error("Mail queue did not answer")),
            MAIL_ENQUEUE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      this.logger.warn("Mail remains in the outbox (job " + jobId + ")");
      return "unavailable";
    } finally {
      clearTimeout(deadline);
    }
  }

  private async ensureQueued(
    { id, kind, userId, requestId, createdAt, deliveryRound }: PendingMail,
    jobId: string,
  ): Promise<"pending" | "finished"> {
    const state = await this.queue.getJobState(jobId);
    if (state === "completed") return "finished";
    if (state === "failed") {
      const job = await this.queue.getJob(jobId);
      if (job) {
        // The outbox still owns this delivery and its provider attempt count.
        await job.retry("failed", {
          resetAttemptsMade: true,
          resetAttemptsStarted: true,
        });
        return "pending";
      }
    } else if (state !== "unknown") {
      return "pending";
    }

    await this.queue.add(
      kind,
      { id, kind, userId, requestId, fromOutbox: true, deliveryRound },
      {
        jobId,
        priority: kind === "confirm" ? 1 : 2,
        attempts: MAIL_SEND_ATTEMPTS,
        backoff: { type: "exponential", delay: 5000 },
        delay:
          kind === "digest"
            ? Math.max(
                0,
                differenceInMilliseconds(addMinutes(createdAt, 3), new Date()),
              )
            : 0,
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 86400 },
      },
    );
    return "pending";
  }
}
