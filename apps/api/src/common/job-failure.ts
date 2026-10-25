import type { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { RetryLaterError } from "./retry-later.error";

/** What a row and an admin's notice keep of an error. */
const MAX_ERROR_LENGTH = 1_000;

/** A failed run counted on its row: how many so far, and whether this one set it aside. */
export type SetAside = { attempts: number; setAside: boolean };

/** An error as a `last_error` column and a notice store it: its text, cut short. */
export function errorText(error: unknown): string {
  return String(error).slice(0, MAX_ERROR_LENGTH);
}

/**
 * What a failed job's log line says: which job, which attempt of how many, and why. BullMQ
 * keeps a failure to itself — a job that throws is retried or dropped and nothing says so
 * unless the worker listens — so every processor logs its `failed` event through this.
 */
export function describeJobFailure(
  job: Pick<Job, "name" | "id" | "attemptsMade" | "opts"> | undefined,
  error: Error,
): string {
  if (job === undefined) return `A job failed: ${error.message}`;

  const attempts = job.opts.attempts ?? 1;
  const last = job.attemptsMade >= attempts ? ", the last one" : "";

  return `Job ${job.name} (${String(job.id)}) failed on attempt ${String(job.attemptsMade)} of ${String(attempts)}${last}: ${error.message}`;
}

/** What every processor's `failed` listener does: a busy retry is a warning, the rest errors. */
export function logJobFailure(
  logger: Pick<Logger, "warn" | "error">,
  job: Pick<Job, "name" | "id" | "attemptsMade" | "opts"> | undefined,
  error: Error,
): void {
  if (error instanceof RetryLaterError) {
    logger.warn(describeJobFailure(job, error));

    return;
  }

  logger.error(describeJobFailure(job, error), error.stack);
}
