import type { Logger } from "@nestjs/common";
import type { Queue } from "bullmq";

/**
 * Every job leaves Redis when it ends: the database holds the record of what the work did,
 * so a finished or failed job kept in the queue is only memory, and `processor.on("failed")`
 * has logged the failure already.
 */
export const DISPOSABLE = {
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/** A repeatable sweep: which scheduler holds it, the job it runs and how often. */
export type SweepSchedule<Name extends string> = {
  schedulerId: string;
  name: Name;
  every: number;
};

/**
 * Registers (or updates, by `schedulerId`) a repeatable sweep. Logged rather than raised: a
 * Redis that is down at boot must not stop the API, and `onFailure` says what still covers
 * the work until the next boot.
 *
 * `Name` is the queue's job names, passed explicitly (`registerSweep<BookingExpiryJob["name"]>`):
 * a processor throws `UnrecoverableError` at a name it does not know, so a sweep the worker
 * cannot run would fail every interval. Left out, it is `never` and nothing compiles.
 */
export async function registerSweep<Name extends string = never>(
  queue: Queue,
  logger: Pick<Logger, "error">,
  { schedulerId, name, every }: SweepSchedule<NoInfer<Name>>,
  onFailure: string,
): Promise<void> {
  try {
    await queue.upsertJobScheduler(
      schedulerId,
      { every },
      { name, data: {}, opts: DISPOSABLE },
    );
  } catch (error) {
    logger.error(`${onFailure}: ${String(error)}`);
  }
}
