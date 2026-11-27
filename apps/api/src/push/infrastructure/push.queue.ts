import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from "@nestjs/common";
import type { Queue } from "bullmq";
import { isConnectionError, RedisOutage } from "../../common/redis-outage";
import {
  PUSH_QUEUE,
  PushJobs,
  type PushJob,
} from "../application/ports/push-jobs";

export const PUSH_PRODUCER = Symbol("PUSH_PRODUCER");
export const PUSH_ENQUEUE_TIMEOUT_MS = 1000;

/**
 * One job per schedule generation: a row handed out twice while
 * its job still waits or runs is one job, and a finished job is removed at once, so the same
 * row can be handed out again when its next try is due. A job is tried once — the retries
 * are Postgres's, written on the row — so a job lost with Redis costs nothing but the lease.
 */
@Injectable()
export class PushQueue extends PushJobs implements OnApplicationShutdown {
  private readonly logger = new Logger(PushQueue.name);

  private readonly redisOutage = new RedisOutage(
    this.logger,
    `The ${PUSH_QUEUE} queue`,
  );

  constructor(@Inject(PUSH_PRODUCER) private readonly queue: Queue<PushJob>) {
    super();
    queue.on("error", (error) => {
      this.redisOutage.report(error, queue.getBackend());
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.disconnect();
  }

  async accepting(): Promise<boolean> {
    try {
      // Without waiting for ready, the client is at hand at once; its status says whether a
      // command would be written or refused for want of the offline queue.
      return (await this.queue.getBackend().client).status === "ready";
    } catch {
      return false;
    }
  }

  async schedule(job: PushJob): Promise<boolean> {
    const jobId = `${job.kind}-${job.id}-${String(job.generation)}`;
    let deadline: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        this.queue.add(job.kind, job, {
          jobId,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        }),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error("Redis did not answer")),
            PUSH_ENQUEUE_TIMEOUT_MS,
          );
        }),
      ]);

      return true;
    } catch (error) {
      // A connection lost between `accepting` and the write is the outage the `error`
      // listener reports once; anything else is worth a line of its own.
      if (isConnectionError(error)) {
        this.redisOutage.report(error, this.queue.getBackend());
      } else {
        this.logger.warn(
          `Push ${jobId} stays in Postgres for the relay: ${String(error)}`,
        );
      }

      return false;
    } finally {
      clearTimeout(deadline);
    }
  }
}
