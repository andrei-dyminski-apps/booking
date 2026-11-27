import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { logJobFailure } from "../../common/job-failure";
import { RedisOutage } from "../../common/redis-outage";
import { PushDispatcher } from "../application/push-dispatcher";
import { PUSH_QUEUE, type PushJob } from "../application/ports/push-jobs";

/** Several at a time: a delivery waits on a push service, and a task on one account's lock. */
const WORKER_CONCURRENCY = 4;

@Processor(PUSH_QUEUE, { concurrency: WORKER_CONCURRENCY })
export class PushProcessor extends WorkerHost {
  private readonly logger = new Logger(PushProcessor.name);

  private readonly redisOutage = new RedisOutage(
    this.logger,
    `The ${PUSH_QUEUE} worker`,
  );

  constructor(private readonly pushDispatcher: PushDispatcher) {
    super();
  }

  async process(job: Job<PushJob>): Promise<void> {
    if (job.data.kind === "task") {
      await this.pushDispatcher.dispatch(job.data);
    } else {
      await this.pushDispatcher.deliver(job.data);
    }
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job<PushJob> | undefined, error: Error): void {
    logJobFailure(this.logger, job, error);
  }

  /** Registered with the worker as it is created, so not one error reaches stderr. */
  @OnWorkerEvent("error")
  onError(error: Error): void {
    this.redisOutage.report(error, this.worker.getBackend());
  }
}
