import { Injectable, Logger } from "@nestjs/common";
import {
  MAX_DELIVERY_ATTEMPTS,
  retryDelay,
  throttlePause,
} from "../domain/push-policy";
import {
  PushOutboxRepository,
  type PendingPushTask,
  type PushDeliveryEnd,
} from "../infrastructure/push-outbox.repository";
import { PushRepository } from "../infrastructure/push.repository";
import { PushGateway } from "./ports/push-gateway";
import type { PushClaim } from "./ports/push-jobs";

/** A job that throws before sending is tried again this much later, up to its cap. */
const PROCESSING_RETRY_MS = 15_000;

/** Runs that threw before a task is set aside — a fault of the API's, not of a push service. */
export const MAX_TASK_FAILURES = 10;
const MAX_DELIVERY_FAILURES = 10;

/**
 * The worker's half of push, in two steps, each a job of its own:
 *
 * 1. **A task is decided** (`dispatch`): the news is read again — a notice read meanwhile, or
 *    a message its recipient's marker has passed, is no longer news — and the account's rules
 *    are applied (`decide`: a muted group, the quiet hours); then it is fanned out to the
 *    account's browsers, one delivery per browser.
 * 2. **A delivery is sent** (`deliver`) to its one browser, and the push service's answer
 *    decides what is next: done, the browser gone, refused for good, or tried again later.
 *
 * At least once: a try whose answer was lost is made again, and the notification's `tag` is
 * what keeps the same push one notification on the screen.
 */
@Injectable()
export class PushDispatcher {
  private readonly logger = new Logger(PushDispatcher.name);

  constructor(
    private readonly pushOutboxRepository: PushOutboxRepository,
    private readonly pushRepository: PushRepository,
    private readonly pushGateway: PushGateway,
  ) {}

  async dispatch(claim: PushClaim): Promise<void> {
    const task = await this.pushOutboxRepository.pendingTask(claim);

    if (task === null) return;

    try {
      await this.decideAndFanOut(task, claim);
    } catch (error) {
      const setAside = await this.pushOutboxRepository.recordTaskFailure(
        claim,
        String(error),
        PROCESSING_RETRY_MS,
        MAX_TASK_FAILURES,
      );

      if (setAside) {
        this.logger.error(
          `Push task ${task.id} set aside after ${String(MAX_TASK_FAILURES)} failed runs: ${String(error)}`,
        );
      }

      throw error;
    }
  }

  async deliver(claim: PushClaim): Promise<void> {
    try {
      await this.deliverClaim(claim);
    } catch (error) {
      // A reserved attempt has already moved to a new generation and has its own retry budget.
      await this.pushOutboxRepository.recordDeliveryFailure(
        claim,
        PROCESSING_RETRY_MS,
        MAX_DELIVERY_FAILURES,
      );
      throw error;
    }
  }

  private async deliverClaim(claim: PushClaim): Promise<void> {
    const delivery = await this.pushOutboxRepository.pendingDelivery(claim);

    if (delivery === null) return;

    const finish = (status: PushDeliveryEnd, reason: string | null = null) =>
      this.pushOutboxRepository.finishDelivery(
        delivery.id,
        status,
        undefined,
        reason,
        { generation: claim.generation },
      );

    if (delivery.target === null) {
      return finish("gone");
    }

    if (delivery.stale) {
      return finish(
        "expired",
        delivery.attempts > 0
          ? "Not delivered before the push went stale"
          : null,
      );
    }

    if (!delivery.recipientActive)
      return finish("skipped", "Recipient is inactive");
    if (this.pushGateway.publicKey === null)
      return finish("skipped", "Push is disabled");

    // The push's remaining lifetime is counted down from the reservation on this process's
    // monotonic clock: a duration needs no agreement with the database's clock.
    const reservingSince = performance.now();
    const attempt = await this.pushOutboxRepository.startAttempt(
      claim,
      delivery.target,
      delivery.task,
    );

    if (attempt === null) return;

    const elapsedMs = performance.now() - reservingSince;
    const ttl = Math.max(
      0,
      Math.floor((attempt.expiresInMs - elapsedMs) / 1000),
    );
    const reservation = {
      generation: attempt.generation,
      target: delivery.target,
    };

    if (ttl === 0) {
      await this.pushOutboxRepository.expireReservedAttempt(
        delivery.id,
        delivery.task,
        attempt,
      );

      return;
    }

    const outcome = await this.pushGateway.send(
      delivery.target,
      { ...attempt.content, receipt: delivery.id },
      ttl,
    );
    const answeredAt = new Date();

    switch (outcome.kind) {
      case "sent":
      case "gone":
        await this.pushOutboxRepository.finishDelivery(
          delivery.id,
          outcome.kind,
          outcome.status,
          null,
          reservation,
        );

        return;
      case "forbidden":
        await this.pushOutboxRepository.forbidDelivery(
          delivery.id,
          outcome.status,
          reservation,
        );

        return;
      case "rejected":
        await this.pushOutboxRepository.finishDelivery(
          delivery.id,
          "rejected",
          outcome.status,
          outcome.reason,
          reservation,
        );

        return;
      case "throttled":
        await this.pushOutboxRepository.throttleDelivery(
          delivery.id,
          delivery.task,
          attempt,
          delivery.target.endpoint,
          throttlePause(outcome.retryAfter, answeredAt),
        );

        return;
      case "unavailable":
        if (attempt.attempts >= MAX_DELIVERY_ATTEMPTS) {
          await this.pushOutboxRepository.finishDelivery(
            delivery.id,
            "failed",
            outcome.status,
            outcome.reason,
            reservation,
          );
          this.logger.warn(
            `Push delivery ${delivery.id} failed ${String(attempt.attempts)} times and was given up: ${outcome.reason}`,
          );

          return;
        }

        await this.pushOutboxRepository.retryDelivery(
          delivery.id,
          retryDelay(attempt.attempts),
          outcome.status,
          outcome.reason,
          attempt.generation,
        );

        return;
    }
  }

  /** Staleness is `fanOut`'s to decide, on the database's clock, before it reads `null` as read. */
  private async decideAndFanOut(
    task: PendingPushTask,
    claim: PushClaim,
  ): Promise<void> {
    if (this.pushGateway.publicKey === null) {
      await this.pushOutboxRepository.skipTask(claim, "off");

      return;
    }

    const news = await this.pushRepository.newsOf(task);

    await this.pushOutboxRepository.fanOut(
      task,
      claim.generation,
      news?.group ?? null,
    );
  }
}
