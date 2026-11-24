import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { MailOutboxRepository } from "./mail-outbox.repository";
import { MailQueue } from "./mail.queue";

const SWEEP_INTERVAL_MS = 1_000;
const SWEEP_BATCH = 50;

@Injectable()
export class MailOutboxRelay
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MailOutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private closing = false;

  constructor(
    private readonly outbox: MailOutboxRepository,
    private readonly queue: MailQueue,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(
      () => void this.sweep(),
      SWEEP_INTERVAL_MS,
    ).unref();
    void this.sweep();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    this.closing = true;
    await this.running;
  }

  sweep(): Promise<void> {
    if (this.closing) return Promise.resolve();
    this.running ??= this.drain()
      .catch(() => this.logger.error("Could not sweep the mail outbox"))
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  private async drain() {
    for (let i = 0; i < SWEEP_BATCH && !this.closing; i++) {
      const task = await this.outbox.claim();
      if (!task) return;
      const state = await this.queue.schedule(task);
      if (state === "unavailable") return;
      if (state === "finished") await this.outbox.acknowledge(task);
    }
  }
}
