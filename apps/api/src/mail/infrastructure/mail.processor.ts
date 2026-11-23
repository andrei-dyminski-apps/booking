import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Logger, type OnModuleDestroy } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { addHours } from "date-fns";
import { logJobFailure } from "../../common/job-failure";
import { RedisOutage } from "../../common/redis-outage";
import { RetryLaterError } from "../../common/retry-later.error";
import { MailDeliveryService } from "../application/mail-delivery.service";
import {
  isPermanentMailFailure,
  MailDeferredError,
  mailFailureText,
} from "../application/ports/mail-gateway";
import {
  MAIL_SEND_ATTEMPTS,
  MailAttemptsExhausted,
  MailRetryExpired,
  mailDeliveryKey,
  type MailAttempt,
  type QueuedMail,
} from "../application/mail-task";
import {
  MailOutboxRepository,
  readMailAttempt,
} from "./mail-outbox.repository";

@Processor("mail", { limiter: { max: 10, duration: 1000 } })
export class MailProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(MailProcessor.name);
  private readonly outage = new RedisOutage(this.logger, "Mail worker");

  constructor(
    private readonly mailDeliveryService: MailDeliveryService,
    private readonly outbox: MailOutboxRepository,
  ) {
    super();
  }

  async onModuleDestroy() {
    // The worker acknowledges Postgres after the provider returns.
    await this.worker.close();
  }

  async process(job: Job<QueuedMail>) {
    if (!job.id) return;
    if (!job.data.fromOutbox)
      await this.outbox.adopt(
        job.data,
        new Date(job.timestamp),
        Math.max(job.attemptsMade, job.attemptsStarted - 1),
      );
    const attempt = await this.outbox.begin(job.data);
    if (!attempt) return;
    if (attempt.sendAttempts >= MAIL_SEND_ATTEMPTS) {
      return this.setAside(job.data, "Mail delivery attempts exhausted");
    }
    // Resend can forget an accepted request once its idempotency window has elapsed.
    if (
      attempt.sendAttempts > 0 &&
      attempt.startedAt &&
      addHours(attempt.startedAt, 24).getTime() <= Date.now()
    ) {
      return this.setAside(job.data, MailRetryExpired.reason);
    }

    let delivery: MailAttempt;
    try {
      delivery = readMailAttempt(job.data.id, attempt, job.data.deliveryRound);
    } catch {
      // A fresh payload could differ from one the provider has already accepted.
      return this.setAside(job.data, "Stored mail delivery could not be read");
    }

    try {
      await this.mailDeliveryService.deliver(
        job.data,
        mailDeliveryKey(job.data),
        delivery,
      );
    } catch (error) {
      if (error instanceof MailDeferredError) {
        await this.outbox.defer(job.data, error.retryAt);
        this.logger.warn(
          `Mail deferred until ${error.retryAt.toISOString()} (job ${job.id}, request ${job.data.requestId ?? "background"})`,
        );
        return;
      }
      if (error instanceof RetryLaterError) throw error;
      if (error instanceof MailRetryExpired)
        return this.setAside(job.data, error.message);

      const exhausted = error instanceof MailAttemptsExhausted;
      const cause = exhausted ? error.cause : error;
      const permanent = isPermanentMailFailure(cause);
      const detail = mailFailureText(cause);
      const reason =
        exhausted && !permanent
          ? "Mail delivery attempts exhausted: " + detail
          : detail;
      if (
        await this.outbox.recordFailure(
          job.data,
          reason,
          permanent || exhausted,
        )
      ) {
        throw new UnrecoverableError("Mail delivery set aside: " + reason);
      }
      throw error;
    }
    await this.outbox.complete(job.data);
  }

  private async setAside(task: QueuedMail, reason: string) {
    if (await this.outbox.recordFailure(task, reason, true))
      throw new UnrecoverableError("Mail delivery set aside: " + reason);
  }

  @OnWorkerEvent("failed") failed(
    job: Job<QueuedMail> | undefined,
    error: Error,
  ) {
    const requestId = job?.data.requestId ?? "background";
    if (error instanceof UnrecoverableError) {
      this.logger.error(
        `Mail delivery failed (job ${job?.id ?? "unknown"}, request ${requestId}): ${error.message}`,
      );
      return;
    }
    if (error instanceof RetryLaterError) {
      logJobFailure(this.logger, job, error);
      return;
    }
    logJobFailure(
      this.logger,
      job,
      new Error(
        `Mail delivery failed (request ${requestId}): ${mailFailureText(error)}`,
      ),
    );
  }
  @OnWorkerEvent("error") error(error: Error) {
    this.outage.report(error, this.worker.getBackend());
  }
}
