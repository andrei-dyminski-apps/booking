export const PUSH_QUEUE = "push";

export type PushClaim = { id: string; generation: number };

/**
 * A row of Postgres for the worker to work on: a task to decide and fan out, or one
 * browser's delivery to send. Its generation identifies the schedule that queued it.
 */
export type PushJob = PushClaim & { kind: "task" | "delivery" };

/**
 * How the relay hands a due row to the worker without naming a queue. `false` when Redis
 * did not take it — the row stays due, and the relay tries again on a later sweep. Never
 * throws.
 */
export abstract class PushJobs {
  /**
   * Whether Redis can take a job right now. The relay asks before it claims anything, so an
   * outage leases no rows and logs nothing per sweep — the queue's `error` listener tells of
   * the outage once. Never throws.
   */
  abstract accepting(): Promise<boolean>;

  abstract schedule(job: PushJob): Promise<boolean>;
}
