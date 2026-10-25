import type { Job } from "bullmq";

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
