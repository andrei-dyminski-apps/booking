import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  PushJobs,
  type PushClaim,
  type PushJob,
} from "../application/ports/push-jobs";
import { PushOutboxRepository } from "./push-outbox.repository";

const SWEEP_INTERVAL_MS = 1_000;
const SWEEP_BATCH = 50;

/** How often the history is pruned, and how much of it is kept. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 30;

/**
 * Queues every task and delivery that is due — new ones, retries whose moment came, the
 * quiet hours that ended, and the rows a lost Redis job left behind once their lease ran
 * out. A row is claimed before its job is queued, so instances sweeping at once hand out
 * different rows. A sweep starts only while Redis is connected — at boot, before the queue's
 * connection is up, and through an outage nothing is claimed; a Redis that refuses a job
 * anyway ends the sweep, and the row comes due again when its lease runs out. Once an hour it deletes what finished over `RETENTION_DAYS`
 * ago: the hourly limit reads the last hour, the receipts are kept for a month.
 */
@Injectable()
export class PushOutboxRelay
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PushOutboxRelay.name);
  private sweepTimer?: NodeJS.Timeout;
  private pruneTimer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private closing = false;

  constructor(
    private readonly pushOutboxRepository: PushOutboxRepository,
    private readonly pushJobs: PushJobs,
  ) {}

  onApplicationBootstrap(): void {
    this.sweepTimer = setInterval(
      () => void this.sweep(),
      SWEEP_INTERVAL_MS,
    ).unref();
    this.pruneTimer = setInterval(
      () => void this.prune(),
      PRUNE_INTERVAL_MS,
    ).unref();
    void this.sweep();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweepTimer);
    clearInterval(this.pruneTimer);
    this.closing = true;
    await this.running;
  }

  sweep(): Promise<void> {
    if (this.closing) return Promise.resolve();

    this.running ??= this.drain()
      .catch((error: unknown) => {
        this.logger.error(`Could not sweep the push outbox: ${String(error)}`);
      })
      .finally(() => {
        this.running = undefined;
      });

    return this.running;
  }

  private async drain(): Promise<void> {
    if (!(await this.pushJobs.accepting())) return;

    const tasks = await this.pushOutboxRepository.claimDueTasks(SWEEP_BATCH);

    if (!(await this.handOut("task", tasks))) return;

    const deliveries =
      await this.pushOutboxRepository.claimDueDeliveries(SWEEP_BATCH);

    await this.handOut("delivery", deliveries);
  }

  /** `false` once Redis refused one: the rest wait for their lease like it. */
  private async handOut(
    kind: PushJob["kind"],
    claims: PushClaim[],
  ): Promise<boolean> {
    for (const claim of claims) {
      if (this.closing) return false;
      if (!(await this.pushJobs.schedule({ kind, ...claim }))) return false;
    }

    return true;
  }

  private async prune(): Promise<void> {
    try {
      const pruned =
        await this.pushOutboxRepository.pruneFinished(RETENTION_DAYS);

      if (pruned > 0)
        this.logger.log(`Pruned ${String(pruned)} finished pushes`);
    } catch (error) {
      this.logger.error(`Could not prune the push outbox: ${String(error)}`);
    }
  }
}
