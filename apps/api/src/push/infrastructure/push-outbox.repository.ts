import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { PushGroup } from "@repo/contracts";
import {
  addMilliseconds,
  differenceInMilliseconds,
  min,
  subHours,
} from "date-fns";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { PushTarget } from "../application/ports/push-gateway";
import type { PushClaim } from "../application/ports/push-jobs";
import type { PushContent } from "../application/push-content";
import {
  decide,
  isStale,
  MAX_DELIVERY_ATTEMPTS,
  pushExpiresAt,
  remainingPushSeconds,
  PUSH_ENDPOINT_HOLD_HOURS,
  PUSH_FORBIDDEN_GRACE_HOURS,
  withinHourlyLimit,
} from "../domain/push-policy";
import { databaseNow } from "./database-clock";
import { pushEndpointHash, PushRepository } from "./push.repository";

/**
 * How long a claimed row is left to the job it was handed to before the relay hands it out
 * again — a job Redis lost, a worker that died mid-send. Longer than a push service may take
 * to answer (the gateway's ten seconds), so a send still running is not sent twice by it.
 */
const LEASE_SECONDS = 30;

/** Finished tasks deleted per statement, so one prune never holds a long lock. */
const PRUNE_BATCH = 1_000;

// Every moment written or compared here is the database's clock read as UTC — the zone the
// columns hold, whatever the session's `TimeZone` — in SQL, or read once by `databaseNow`
// inside the transaction that decides against it. The worker compares no moment of its own
// against them, and hands the outbox durations rather than moments: each new schedule of a
// row bumps its generation, so a job of the current generation was queued while the row was
// due.

export type PushTaskKind = "notice" | "message";

/** A task still to decide: the news, its recipient and when it was written. */
export type PendingPushTask = {
  id: string;
  kind: PushTaskKind;
  userId: string;
  createdAt: Date;
};

/** What stops a task before its news is read. `fanOut` decides every other outcome. */
export type PushSkip = "off";

/** One browser's delivery still to send; `target` is `null` once its browser's row is gone. */
export type PendingPushDelivery = {
  id: string;
  attempts: number;
  task: PendingPushTask;
  target: PushTarget | null;
  recipientActive: boolean;
  /** Past the push's lifetime on the database's clock. */
  stale: boolean;
};

export type PushDeliveryEnd =
  "sent" | "gone" | "rejected" | "expired" | "failed" | "skipped";

type DeliveryAttempt = { generation: number; target?: PushTarget };

type ReservedPushAttempt = {
  attempts: number;
  generation: number;
  previousAttemptAt: Date | null;
};

export type ReturnedPushAttempt = Pick<
  ReservedPushAttempt,
  "generation" | "previousAttemptAt"
>;

function postponedSchedule(until: Date, createdAt: Date, quiet: boolean) {
  return {
    availableAt: min([until, pushExpiresAt(createdAt)]),
    waitingForQuietHours: quiet,
    leasedUntil: null,
    generation: { increment: 1 },
  };
}

// Settings writes take FOR NO KEY UPDATE on the same row before changing schedules.
async function lockRecipient(tx: Prisma.TransactionClient, userId: string) {
  const [recipient] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM users
    WHERE id = ${userId}::uuid AND blocked_at IS NULL AND deleted_at IS NULL
    FOR SHARE
  `;
  return recipient !== undefined;
}

async function lockAttempts(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`push:${userId}`}, 0))`;
}

/** The order `startAttempt` takes them in: the recipient, its attempt lock, the task. */
async function lockAttemptAccounting(
  tx: Prisma.TransactionClient,
  task: PendingPushTask,
) {
  // Not narrowed to active accounts: a blocked one still needs its reservation given back.
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${task.userId}::uuid FOR SHARE`;
  await lockAttempts(tx, task.userId);
  await tx.$queryRaw`SELECT id FROM push_tasks WHERE id = ${task.id}::uuid FOR UPDATE`;
}

/**
 * Gives a reserved attempt back, and with it the task's place in the hourly limit, which
 * is read off its deliveries again. The caller holds `lockAttemptAccounting`.
 */
async function returnAttempt(
  tx: Prisma.TransactionClient,
  id: string,
  task: PendingPushTask,
  { generation, previousAttemptAt }: ReturnedPushAttempt,
  data: Prisma.PushDeliveryUpdateManyMutationInput,
): Promise<void> {
  const updated = await tx.pushDelivery.updateMany({
    where: { id, taskId: task.id, status: "pending", generation },
    data: {
      ...data,
      attempts: { decrement: 1 },
      lastAttemptAt: previousAttemptAt,
    },
  });
  if (updated.count === 0) return;

  const { _max } = await tx.pushDelivery.aggregate({
    where: { taskId: task.id },
    _max: { lastAttemptAt: true },
  });
  await tx.pushTask.update({
    where: { id: task.id },
    data: { lastAttemptAt: _max.lastAttemptAt },
  });
}

// Reservations and 429s agree on the deadline even if the subscription row is replaced.
async function lockEndpointBackoff(
  tx: Prisma.TransactionClient,
  endpointHash: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`push-backoff:${endpointHash}`}, 0))`;
}

/**
 * The subscription a delivery's attempt went to, locked, while it is still the one the
 * attempt used: the same account as the task, the same endpoint and keys.
 */
async function lockAttemptedSubscription(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  target: PushTarget,
): Promise<{ id: string } | undefined> {
  const [subscription] = await tx.$queryRaw<{ id: string }[]>`
    SELECT subscription.id FROM push_subscriptions AS subscription
    JOIN push_deliveries AS delivery ON delivery.subscription_id = subscription.id
    JOIN push_tasks AS task ON task.id = delivery.task_id
    WHERE delivery.id = ${deliveryId}::uuid AND subscription.user_id = task.user_id
      AND subscription.endpoint = ${target.endpoint}
      AND subscription.p256dh = ${target.p256dh} AND subscription.auth = ${target.auth}
    FOR UPDATE OF subscription
  `;

  return subscription;
}

/**
 * Called inside the transaction that writes the notice or the message, so the push is as
 * durable as the news. Only for an account with a browser to push to: with none — push off,
 * or never turned on — there is nothing to deliver, and a task would only be a row to sweep.
 * A browser subscribed after this moment is not told about news written before it.
 */
export async function recordPushTask(
  tx: Prisma.TransactionClient,
  { kind, id, userId }: { kind: PushTaskKind; id: string; userId: string },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO push_tasks (id, kind, user_id, subscription_ids)
    SELECT ${id}::uuid, ${kind}::"PushTaskKind", ${userId}::uuid, array_agg(subscription.id)
    FROM push_subscriptions AS subscription
    WHERE subscription.user_id = ${userId}::uuid
    HAVING count(*) > 0
    ON CONFLICT (id) DO NOTHING
  `;
}

/**
 * Every query over `push_tasks` and `push_deliveries`. Postgres is the schedule: a row is due
 * when its `available_at` has passed and its queue lease has ended. A new schedule gets a
 * new generation so a job left behind in Redis cannot work on it.
 */
@Injectable()
export class PushOutboxRepository {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly pushRepository: PushRepository,
  ) {}

  async claimDueTasks(limit: number): Promise<PushClaim[]> {
    return this.prismaService.$queryRaw<PushClaim[]>`
      UPDATE push_tasks
      SET leased_until = (now() AT TIME ZONE 'UTC') + ${LEASE_SECONDS}::int * interval '1 second'
      WHERE id IN (
        SELECT id FROM push_tasks
        WHERE outcome IS NULL AND available_at <= (now() AT TIME ZONE 'UTC')
        AND (leased_until IS NULL OR leased_until <= (now() AT TIME ZONE 'UTC'))
        ORDER BY available_at, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, generation
    `;
  }

  async claimDueDeliveries(limit: number): Promise<PushClaim[]> {
    return this.prismaService.$queryRaw<PushClaim[]>`
      UPDATE push_deliveries
      SET leased_until = (now() AT TIME ZONE 'UTC') + ${LEASE_SECONDS}::int * interval '1 second'
      WHERE id IN (
        SELECT id FROM push_deliveries
        WHERE status = 'pending' AND available_at <= (now() AT TIME ZONE 'UTC')
        AND (leased_until IS NULL OR leased_until <= (now() AT TIME ZONE 'UTC'))
        ORDER BY available_at, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, generation
    `;
  }

  async pendingTask({
    id,
    generation,
  }: PushClaim): Promise<PendingPushTask | null> {
    return this.prismaService.pushTask.findFirst({
      where: {
        id,
        generation,
        outcome: null,
      },
      select: { id: true, kind: true, userId: true, createdAt: true },
    });
  }

  async skipTask(
    { id, generation }: PushClaim,
    outcome: PushSkip,
  ): Promise<void> {
    await this.prismaService.$executeRaw`
      UPDATE push_tasks
      SET outcome = ${outcome}::"PushTaskOutcome",
          finished_at = (now() AT TIME ZONE 'UTC'),
          waiting_for_quiet_hours = false
      WHERE id = ${id}::uuid AND generation = ${generation} AND outcome IS NULL
    `;
  }

  /**
   * Counts a run that threw. Below `maxFailures` the task is due again `delayMs` later; at it,
   * the task is set aside as `failed` and nothing picks it up again. `true` when set aside.
   */
  async recordTaskFailure(
    { id, generation }: PushClaim,
    reason: string,
    delayMs: number,
    maxFailures: number,
  ): Promise<boolean> {
    const [row] = await this.prismaService.$queryRaw<
      { outcome: string | null }[]
    >`
      UPDATE push_tasks
      SET failures = failures + 1,
          last_error = ${reason},
          available_at = (now() AT TIME ZONE 'UTC') + ${delayMs}::int * interval '1 millisecond',
          waiting_for_quiet_hours = false,
          leased_until = NULL,
          generation = generation + 1,
          outcome = CASE WHEN failures + 1 >= ${maxFailures}
                         THEN 'failed'::"PushTaskOutcome" END,
          finished_at = CASE WHEN failures + 1 >= ${maxFailures}
                             THEN (now() AT TIME ZONE 'UTC') END
      WHERE id = ${id}::uuid AND generation = ${generation} AND outcome IS NULL
      RETURNING outcome
    `;

    return row?.outcome === "failed";
  }

  /**
   * Applies current preferences before handing a task to its subscribed browsers. `group` is
   * `null` when the news was read meanwhile; a push past its lifetime is `stale` either way.
   */
  async fanOut(
    task: PendingPushTask,
    generation: number,
    group: PushGroup | null,
  ): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
      const active = await lockRecipient(tx, task.userId);
      const [locked] = await tx.$queryRaw<{ subscriptionIds: string[] }[]>`
        SELECT subscription_ids AS "subscriptionIds" FROM push_tasks
        WHERE id = ${task.id}::uuid AND generation = ${generation} AND outcome IS NULL
        FOR UPDATE
      `;

      if (locked === undefined) return;

      const now = await databaseNow(tx);
      let outcome: Prisma.PushTaskUpdateInput["outcome"] = "untargeted";
      if (remainingPushSeconds(task.createdAt, now) === 0) {
        outcome = "stale";
      } else if (group === null) {
        outcome = "read";
      } else if (active) {
        const preferences = await this.pushRepository.preferencesOf(
          task.userId,
          tx,
        );
        const decision = decide(group, preferences, now);
        if (decision.kind === "wait") {
          await tx.pushTask.update({
            where: { id: task.id },
            data: postponedSchedule(decision.until, task.createdAt, true),
          });
          return;
        }
        if (decision.kind === "skip") {
          outcome = decision.reason;
        } else {
          const targets = await tx.pushSubscription.findMany({
            where: { id: { in: locked.subscriptionIds }, userId: task.userId },
            select: { id: true },
          });
          if (targets.length > 0) {
            await tx.pushDelivery.createMany({
              data: targets.map(({ id: subscriptionId }) => ({
                id: randomUUID(),
                taskId: task.id,
                subscriptionId,
              })),
            });
            outcome = "dispatched";
          }
        }
      }

      await tx.pushTask.update({
        where: { id: task.id },
        data: { outcome, finishedAt: now, waitingForQuietHours: false },
      });
    });
  }

  async pendingDelivery({
    id,
    generation,
  }: PushClaim): Promise<PendingPushDelivery | null> {
    const row = await this.prismaService.pushDelivery.findFirst({
      where: {
        id,
        generation,
        status: "pending",
      },
      select: {
        id: true,
        attempts: true,
        task: {
          select: { id: true, kind: true, userId: true, createdAt: true },
        },
        subscription: {
          select: {
            userId: true,
            endpoint: true,
            p256dh: true,
            auth: true,
            user: { select: { blockedAt: true, deletedAt: true } },
          },
        },
      },
    });

    if (row === null) return null;

    const now = await databaseNow(this.prismaService);
    const { subscription, task } = row;
    const target = subscription?.userId === task.userId ? subscription : null;

    return {
      id: row.id,
      attempts: row.attempts,
      task,
      target:
        target === null
          ? null
          : {
              endpoint: target.endpoint,
              p256dh: target.p256dh,
              auth: target.auth,
            },
      recipientActive:
        target?.user.blockedAt === null && target.user.deletedAt === null,
      stale: isStale(task.createdAt, now),
    };
  }

  /** Count processing failures that did not reach an HTTP attempt. */
  async recordDeliveryFailure(
    { id, generation }: PushClaim,
    delayMs: number,
    maxFailures: number,
  ): Promise<void> {
    await this.prismaService.$executeRaw`
      UPDATE push_deliveries
      SET failures = failures + 1,
          last_error = 'Push delivery processing failed',
          available_at = (now() AT TIME ZONE 'UTC') + ${delayMs}::int * interval '1 millisecond',
          waiting_for_quiet_hours = false,
          leased_until = NULL,
          generation = generation + 1,
          status = CASE WHEN failures + 1 >= ${maxFailures}
                        THEN 'failed'::"PushDeliveryStatus" ELSE status END
      WHERE id = ${id}::uuid AND generation = ${generation} AND status = 'pending'
        AND available_at <= (now() AT TIME ZONE 'UTC')
    `;
  }

  /**
   * Counts the try before it is made, and moves the row a lease ahead: a worker that dies
   * mid-send has still spent the try, and the relay hands the row out again once the lease
   * has run out. The recipient lock orders reservation with blocks and account erasure.
   * A delivery that spent its last attempt in an interrupted run fails here. `expiresInMs` is
   * what was left of the push's lifetime at the reservation, on the database's clock, for the
   * worker to count down on its own.
   */
  async startAttempt(
    claim: PushClaim,
    target: PushTarget,
    pendingTask: PendingPushTask,
  ): Promise<
    (ReservedPushAttempt & { content: PushContent; expiresInMs: number }) | null
  > {
    const { id: taskId, userId, createdAt } = pendingTask;
    const endpointHash = pushEndpointHash(target.endpoint);
    return this.prismaService.$transaction(async (tx) => {
      if (!(await lockRecipient(tx, userId))) return null;
      await lockAttempts(tx, userId);
      const [task] = await tx.$queryRaw<
        { lastAttemptAt: Date | null; outcome: string | null }[]
      >`
        SELECT last_attempt_at AS "lastAttemptAt", outcome
        FROM push_tasks
        WHERE id = ${taskId}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;
      if (task === undefined) return null;

      await lockEndpointBackoff(tx, endpointHash);
      const hold = await tx.pushEndpointHold.findUnique({
        where: { endpointHash },
        select: { retryAfter: true },
      });
      const preferences = await this.pushRepository.preferencesOf(userId, tx);
      const news = await this.pushRepository.newsOf(pendingTask, tx);
      const now = await databaseNow(tx);
      const pending = {
        id: claim.id,
        generation: claim.generation,
        taskId,
        status: "pending" as const,
      };
      if (remainingPushSeconds(createdAt, now) === 0) {
        await tx.pushDelivery.updateMany({
          where: pending,
          data: { status: "expired", waitingForQuietHours: false },
        });
        return null;
      }

      if (news === null) {
        await tx.pushDelivery.updateMany({
          where: pending,
          data: {
            status: "skipped",
            waitingForQuietHours: false,
            lastError: "The notification or message is no longer unread",
          },
        });
        return null;
      }

      const decision = decide(news.group, preferences, now);
      if (decision.kind === "skip") {
        await tx.pushDelivery.updateMany({
          where: pending,
          data: {
            status: "skipped",
            waitingForQuietHours: false,
            lastError: "Push group is muted",
          },
        });
        return null;
      }
      if (decision.kind === "wait") {
        await tx.pushDelivery.updateMany({
          where: pending,
          data: postponedSchedule(decision.until, createdAt, true),
        });
        return null;
      }

      if (hold?.retryAfter && hold.retryAfter > now) {
        await tx.pushDelivery.updateMany({
          where: pending,
          data: postponedSchedule(hold.retryAfter, createdAt, false),
        });
        return null;
      }

      const since = subHours(now, 1);
      let allowed = task.outcome === "dispatched";
      if (
        allowed &&
        preferences.hourlyLimit !== null &&
        (task.lastAttemptAt === null || task.lastAttemptAt <= since)
      ) {
        const recent = await tx.pushTask.count({
          where: { userId, lastAttemptAt: { gt: since } },
        });
        allowed = withinHourlyLimit(recent, preferences.hourlyLimit);
      }

      if (!allowed) {
        const { count } = await tx.pushDelivery.updateMany({
          where: pending,
          data: {
            status: "skipped",
            waitingForQuietHours: false,
            lastError: "Hourly push limit reached",
          },
        });

        if (
          count > 0 &&
          task.outcome === "dispatched" &&
          task.lastAttemptAt === null
        ) {
          await tx.pushTask.update({
            where: { id: taskId },
            data: { outcome: "limited" },
          });
        }
        return null;
      }

      const attempt = await this.reserveAttempt(
        tx,
        claim,
        target,
        pendingTask,
        pushExpiresAt(createdAt),
      );
      if (attempt === null || attempt.attemptedAt === null) return null;

      await tx.pushTask.update({
        where: { id: taskId },
        data: { lastAttemptAt: attempt.attemptedAt },
      });
      return {
        ...attempt,
        content: news.content,
        expiresInMs: differenceInMilliseconds(
          pushExpiresAt(createdAt),
          attempt.attemptedAt,
        ),
      };
    });
  }

  private async reserveAttempt(
    tx: Prisma.TransactionClient,
    { id, generation }: PushClaim,
    target: PushTarget,
    { id: taskId, userId }: PendingPushTask,
    expiresAt: Date,
  ): Promise<(ReservedPushAttempt & { attemptedAt: Date | null }) | null> {
    const [row] = await tx.$queryRaw<
      (ReservedPushAttempt & { attemptedAt: Date | null })[]
    >`
      WITH locked AS (
        SELECT delivery.id, delivery.last_attempt_at, delivery.attempts
        FROM push_deliveries AS delivery
        JOIN push_subscriptions AS subscription ON subscription.id = delivery.subscription_id
        JOIN push_tasks AS task ON task.id = delivery.task_id
        WHERE delivery.id = ${id}::uuid AND delivery.status = 'pending'
          AND delivery.generation = ${generation} AND delivery.available_at <= (statement_timestamp() AT TIME ZONE 'UTC')
          AND task.id = ${taskId}::uuid AND subscription.user_id = task.user_id
          AND subscription.endpoint = ${target.endpoint}
          AND subscription.p256dh = ${target.p256dh} AND subscription.auth = ${target.auth}
        FOR UPDATE OF delivery
      ), measured AS (
        SELECT locked.*, clock_timestamp() AT TIME ZONE 'UTC' AS checked_at FROM locked
      ), eligible AS (
        SELECT measured.*,
               CASE
                 WHEN ${expiresAt}::timestamp < checked_at + interval '1 second'
                   THEN 'expired'::"PushDeliveryStatus"
                 WHEN attempts >= ${MAX_DELIVERY_ATTEMPTS}
                   THEN 'failed'::"PushDeliveryStatus"
                 ELSE 'pending'::"PushDeliveryStatus"
               END AS status
        FROM measured
      ), reserved AS (
        UPDATE push_deliveries AS delivery
        SET attempts = delivery.attempts + CASE WHEN eligible.status = 'pending' THEN 1 ELSE 0 END,
            status = eligible.status,
            last_error = CASE WHEN eligible.status = 'failed'
                              THEN 'Last push attempt was interrupted' ELSE delivery.last_error END,
            last_attempt_at = CASE WHEN eligible.status = 'pending'
                                   THEN eligible.checked_at ELSE delivery.last_attempt_at END,
            available_at = eligible.checked_at + ${LEASE_SECONDS}::int * interval '1 second',
            waiting_for_quiet_hours = false,
            leased_until = NULL,
            generation = delivery.generation + 1
        FROM eligible
        WHERE delivery.id = eligible.id
        RETURNING delivery.attempts, delivery.generation,
                  eligible.last_attempt_at AS "previousAttemptAt",
                  CASE WHEN delivery.status = 'pending' THEN delivery.last_attempt_at END AS "attemptedAt"
      ), endpoint_hold AS (
        INSERT INTO push_endpoint_holds (endpoint_hash, user_id, expires_at)
        SELECT ${pushEndpointHash(target.endpoint)}, ${userId}::uuid,
               "attemptedAt" + ${PUSH_ENDPOINT_HOLD_HOURS}::int * interval '1 hour'
        FROM reserved WHERE "attemptedAt" IS NOT NULL
        ON CONFLICT (endpoint_hash) DO UPDATE
        SET expires_at = GREATEST(push_endpoint_holds.expires_at, EXCLUDED.expires_at),
            user_id = EXCLUDED.user_id
      )
      SELECT * FROM reserved
    `;

    return row ?? null;
  }

  /** The deadline can pass during commit. Give back a reservation that never reached HTTP. */
  async expireReservedAttempt(
    id: string,
    task: PendingPushTask,
    attempt: ReturnedPushAttempt,
  ): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
      await lockAttemptAccounting(tx, task);
      await returnAttempt(tx, id, task, attempt, {
        status: "expired",
        lastError: "Push went stale before sending",
      });
    });
  }

  /**
   * A provider's `gone` invalidates the exact subscription used by the attempt. Lock the
   * subscription before its deliveries, the same order as an unsubscribe or erasure.
   */
  async finishDelivery(
    id: string,
    status: PushDeliveryEnd,
    responseStatus: number | null | undefined,
    reason: string | null,
    attempt: DeliveryAttempt,
  ): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
      const subscription =
        status === "gone" && attempt.target !== undefined
          ? await lockAttemptedSubscription(tx, id, attempt.target)
          : undefined;
      const [row] = await tx.pushDelivery.updateManyAndReturn({
        where: {
          id,
          status: "pending",
          generation: attempt.generation,
        },
        data: {
          status,
          waitingForQuietHours: false,
          ...(responseStatus === undefined ? {} : { responseStatus }),
          lastError: reason,
          ...(status === "sent" ? { sentAt: await databaseNow(tx) } : {}),
        },
        select: { subscriptionId: true },
      });

      if (
        subscription !== undefined &&
        row?.subscriptionId === subscription.id
      ) {
        await tx.pushSubscription.deleteMany({
          where: { id: subscription.id },
        });
      }
    });
  }

  /**
   * A `403` ends this delivery as `rejected` and keeps the subscription, until the browser
   * has answered nothing but `403` for `PUSH_FORBIDDEN_GRACE_HOURS`: a push it took since,
   * or a renewal of its keys (which stamps `created_at`), starts the count again. Locks the
   * subscription first, as `finishDelivery` does.
   */
  async forbidDelivery(
    id: string,
    responseStatus: number,
    attempt: Required<DeliveryAttempt>,
  ): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
      const subscription = await lockAttemptedSubscription(
        tx,
        id,
        attempt.target,
      );
      const [row] = await tx.pushDelivery.updateManyAndReturn({
        where: { id, status: "pending", generation: attempt.generation },
        data: {
          status: "rejected",
          waitingForQuietHours: false,
          responseStatus,
          lastError: "The push service refused the VAPID credentials",
        },
        select: { subscriptionId: true },
      });

      if (subscription === undefined || row?.subscriptionId !== subscription.id)
        return;

      const [refused] = await tx.$queryRaw<{ expired: boolean }[]>`
        SELECT min(delivery.last_attempt_at)
                 <= (now() AT TIME ZONE 'UTC') - ${PUSH_FORBIDDEN_GRACE_HOURS}::int * interval '1 hour'
               AS expired
        FROM push_deliveries AS delivery
        JOIN push_subscriptions AS subscription ON subscription.id = delivery.subscription_id
        WHERE delivery.subscription_id = ${subscription.id}::uuid
          AND delivery.response_status = 403
          AND delivery.last_attempt_at >= subscription.created_at
          AND NOT EXISTS (
            SELECT 1 FROM push_deliveries AS taken
            WHERE taken.subscription_id = delivery.subscription_id
              AND taken.status = 'sent' AND taken.sent_at >= delivery.last_attempt_at
          )
      `;

      if (refused?.expired === true) {
        await tx.pushSubscription.deleteMany({
          where: { id: subscription.id },
        });
        await tx.pushDelivery.updateMany({
          where: { id },
          data: {
            status: "gone",
            lastError: `Refused with 403 for ${String(PUSH_FORBIDDEN_GRACE_HOURS)} hours`,
          },
        });
      }
    });
  }

  /** Due again `delayMs` after a provider failure. */
  async retryDelivery(
    id: string,
    delayMs: number,
    responseStatus: number | null,
    reason: string,
    generation: number,
  ): Promise<void> {
    const now = await databaseNow(this.prismaService);
    await this.prismaService.pushDelivery.updateMany({
      where: { id, status: "pending", generation },
      data: {
        availableAt: addMilliseconds(now, delayMs),
        waitingForQuietHours: false,
        leasedUntil: null,
        generation: { increment: 1 },
        responseStatus,
        lastError: reason,
      },
    });
  }

  /**
   * Gives back the try — its count and its place in the hourly limit — and pauses every new
   * attempt on the endpoint for `pauseMs` after a 429.
   */
  async throttleDelivery(
    id: string,
    task: PendingPushTask,
    attempt: ReturnedPushAttempt,
    endpoint: string,
    pauseMs: number,
  ): Promise<void> {
    const endpointHash = pushEndpointHash(endpoint);
    await this.prismaService.$transaction(async (tx) => {
      await lockAttemptAccounting(tx, task);
      await lockEndpointBackoff(tx, endpointHash);
      const now = await databaseNow(tx);
      const until = addMilliseconds(now, pauseMs);
      const [hold] = await tx.$queryRaw<{ retryAfter: Date }[]>`
        INSERT INTO push_endpoint_holds (endpoint_hash, expires_at, retry_after)
        VALUES (${endpointHash}, ${now}, ${until})
        ON CONFLICT (endpoint_hash) DO UPDATE
        SET retry_after = GREATEST(push_endpoint_holds.retry_after, EXCLUDED.retry_after)
        RETURNING retry_after AS "retryAfter"
      `;
      await returnAttempt(tx, id, task, attempt, {
        ...postponedSchedule(hold?.retryAfter ?? until, task.createdAt, false),
        responseStatus: 429,
        lastError: "Throttled by the push service",
      });
    });
  }

  /** Tasks finished over `retentionDays` ago, their deliveries with them, a batch at a time. */
  async pruneFinished(retentionDays: number): Promise<number> {
    let pruned = 0;

    for (;;) {
      const count = await this.prismaService.$executeRaw`
        DELETE FROM push_tasks WHERE id IN (
          SELECT id FROM push_tasks
          WHERE outcome IS NOT NULL
            AND finished_at < (now() AT TIME ZONE 'UTC') - ${retentionDays}::int * interval '1 day'
          LIMIT ${PRUNE_BATCH}
        )
      `;
      pruned += count;
      if (count < PRUNE_BATCH) break;
    }

    await this.prismaService.$executeRaw`
      DELETE FROM push_endpoint_holds
      WHERE expires_at <= (now() AT TIME ZONE 'UTC')
        AND (retry_after IS NULL OR retry_after <= (now() AT TIME ZONE 'UTC'))
    `;

    return pruned;
  }
}
