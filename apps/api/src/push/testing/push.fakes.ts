import { randomUUID } from "node:crypto";
import {
  DEFAULT_PUSH_PREFERENCES,
  type Notification,
  type PushGroup,
  type PushPreferences,
  type PushReceipt,
  type PushSubscriptionInput,
} from "@repo/contracts";
import {
  addMilliseconds,
  differenceInMilliseconds,
  max,
  min,
  subHours,
} from "date-fns";
import type { PublicOf } from "../../common/testing/public-of.fakes";
import {
  decide,
  isStale,
  pushExpiresAt,
  pushGroupOf,
  remainingPushSeconds,
} from "../domain/push-policy";
import type { PushTarget } from "../application/ports/push-gateway";
import type { PushClaim } from "../application/ports/push-jobs";
import {
  messagePush,
  noticePush,
  type MessagePushSource,
  type PushNews,
} from "../application/push-content";
import type {
  PendingPushDelivery,
  PendingPushTask,
  PushDeliveryEnd,
  PushOutboxRepository,
  PushSkip,
  PushTaskKind,
} from "../infrastructure/push-outbox.repository";
import type { PushRepository } from "../infrastructure/push.repository";

type StoredSubscription = PushTarget & { id: string; userId: string };

/**
 * The browsers, preferences and receipts in memory, and the records a push is worded from.
 * What the SQL decides — read, erased, blocked — is the e2e spec's half; here it is whether
 * the fake hands the record back.
 */
export class FakePushRepository implements PublicOf<PushRepository> {
  readonly subscriptions: StoredSubscription[] = [];
  readonly preferences = new Map<string, PushPreferences>();
  readonly receipts: PushReceipt[] = [];
  readonly notices = new Map<
    string,
    { userId: string; notice: Notification }
  >();
  readonly messages = new Map<
    string,
    { userId: string; source: MessagePushSource }
  >();

  save(userId: string, { endpoint, keys }: PushSubscriptionInput) {
    void this.removeGone(endpoint);
    this.subscriptions.push({ id: randomUUID(), userId, endpoint, ...keys });

    return Promise.resolve();
  }

  hasSubscription(userId: string, endpoint: string) {
    return Promise.resolve(
      this.subscriptions.some(
        (row) => row.userId === userId && row.endpoint === endpoint,
      ),
    );
  }

  remove(userId: string, endpoint: string) {
    this.keep((row) => row.userId !== userId || row.endpoint !== endpoint);

    return Promise.resolve();
  }

  removeGone(endpoint: string) {
    this.keep((row) => row.endpoint !== endpoint);

    return Promise.resolve();
  }

  preferencesOf(userId: string) {
    return Promise.resolve(
      this.preferences.get(userId) ?? DEFAULT_PUSH_PREFERENCES,
    );
  }

  savePreferences(userId: string, preferences: PushPreferences) {
    this.preferences.set(userId, preferences);

    return Promise.resolve();
  }

  recordReceipt(receipt: PushReceipt) {
    this.receipts.push(receipt);

    return Promise.resolve();
  }

  newsOf(task: PendingPushTask): Promise<PushNews | null> {
    if (task.kind === "notice") {
      const stored = this.notices.get(task.id);
      return Promise.resolve(
        stored?.userId === task.userId
          ? {
              group: pushGroupOf(stored.notice.type),
              content: noticePush(stored.notice),
            }
          : null,
      );
    }
    const message = this.messages.get(task.id);
    return Promise.resolve(
      message?.userId === task.userId
        ? {
            group: "messages",
            content: { ...messagePush(message.source), messageAt: Date.now() },
          }
        : null,
    );
  }

  private keep(predicate: (row: StoredSubscription) => boolean) {
    this.subscriptions.splice(
      0,
      this.subscriptions.length,
      ...this.subscriptions.filter(predicate),
    );
  }
}

type StoredTask = PendingPushTask & {
  generation: number;
  subscriptionIds: string[];
  availableAt: Date;
  outcome: string | null;
  finishedAt: Date | null;
  lastAttemptAt: Date | null;
  failures: number;
};

type StoredDelivery = {
  id: string;
  taskId: string;
  generation: number;
  subscriptionId: string | null;
  lastAttemptAt: Date | null;
  status: "pending" | PushDeliveryEnd;
  attempts: number;
  failures: number;
  availableAt: Date | null;
  responseStatus: number | null;
  lastError: string | null;
};

/** The outbox in memory, reading the browsers of the fake repository it is given. */
export class FakePushOutboxRepository implements PublicOf<PushOutboxRepository> {
  readonly tasks = new Map<string, StoredTask>();
  readonly deliveries = new Map<string, StoredDelivery>();
  private readonly retryAfter = new Map<string, Date>();

  constructor(private readonly pushRepository: FakePushRepository) {}

  addTask(kind: PushTaskKind, id: string, userId: string, createdAt: Date) {
    this.tasks.set(id, {
      id,
      kind,
      userId,
      createdAt,
      generation: 0,
      subscriptionIds: this.pushRepository.subscriptions
        .filter((row) => row.userId === userId)
        .map((row) => row.id),
      availableAt: createdAt,
      outcome: null,
      finishedAt: null,
      lastAttemptAt: null,
      failures: 0,
    });
  }

  claimDueTasks() {
    return Promise.resolve([]);
  }

  claimDueDeliveries() {
    return Promise.resolve([]);
  }

  pendingTask({ id, generation }: PushClaim) {
    const task = this.tasks.get(id);

    return Promise.resolve(
      task === undefined ||
        task.outcome !== null ||
        task.generation !== generation ||
        task.availableAt > new Date()
        ? null
        : {
            id: task.id,
            kind: task.kind,
            userId: task.userId,
            createdAt: task.createdAt,
          },
    );
  }

  skipTask({ id, generation }: PushClaim, outcome: PushSkip) {
    if (this.tasks.get(id)?.generation === generation)
      this.finish(id, outcome, new Date());

    return Promise.resolve();
  }

  postponeTask({ id, generation }: PushClaim, until: Date) {
    const task = this.tasks.get(id);

    if (task?.outcome === null && task.generation === generation) {
      task.availableAt = until;
      task.generation += 1;
    }

    return Promise.resolve();
  }

  recordTaskFailure(
    { id, generation }: PushClaim,
    _reason: string,
    delayMs: number,
    maxFailures: number,
  ) {
    const task = this.tasks.get(id);

    if (task?.outcome !== null || task.generation !== generation)
      return Promise.resolve(false);

    task.failures += 1;
    task.generation += 1;
    task.availableAt = addMilliseconds(new Date(), delayMs);

    if (task.failures >= maxFailures) task.outcome = "failed";

    return Promise.resolve(task.outcome === "failed");
  }

  async fanOut(
    task: PendingPushTask,
    generation: number,
    group: PushGroup | null,
  ): Promise<void> {
    const stored = this.tasks.get(task.id);
    if (stored?.outcome !== null || stored.generation !== generation) {
      return;
    }

    const now = new Date();
    if (remainingPushSeconds(task.createdAt, now) === 0) {
      this.finish(task.id, "stale", now);
      return;
    }
    if (group === null) {
      this.finish(task.id, "read", now);
      return;
    }
    const decision = decide(
      group,
      await this.pushRepository.preferencesOf(task.userId),
      now,
    );
    if (decision.kind === "skip") {
      this.finish(task.id, decision.reason, now);
      return;
    }
    if (decision.kind === "wait") {
      await this.postponeTask({ id: task.id, generation }, decision.until);
      return;
    }

    const targets = this.pushRepository.subscriptions.filter(
      (row) =>
        row.userId === task.userId && stored.subscriptionIds.includes(row.id),
    );

    if (targets.length === 0) {
      this.finish(task.id, "untargeted", now);

      return;
    }

    for (const target of targets) {
      const id = randomUUID();

      this.deliveries.set(id, {
        id,
        taskId: task.id,
        generation: 0,
        subscriptionId: target.id,
        lastAttemptAt: null,
        status: "pending",
        attempts: 0,
        failures: 0,
        availableAt: null,
        responseStatus: null,
        lastError: null,
      });
    }

    this.finish(task.id, "dispatched", now);
  }

  pendingDelivery({
    id,
    generation,
  }: PushClaim): Promise<PendingPushDelivery | null> {
    const delivery = this.deliveries.get(id);
    const task = delivery && this.tasks.get(delivery.taskId);

    if (
      delivery?.status !== "pending" ||
      delivery.generation !== generation ||
      task === undefined ||
      (delivery.availableAt !== null && delivery.availableAt > new Date())
    ) {
      return Promise.resolve(null);
    }

    const target = this.pushRepository.subscriptions.find(
      (row) => row.id === delivery.subscriptionId,
    );

    return Promise.resolve({
      id,
      attempts: delivery.attempts,
      task,
      recipientActive: target !== undefined,
      stale: isStale(task.createdAt, new Date()),
      target:
        target === undefined
          ? null
          : {
              endpoint: target.endpoint,
              p256dh: target.p256dh,
              auth: target.auth,
            },
    });
  }

  recordDeliveryFailure(
    claim: PushClaim,
    delayMs: number,
    maxFailures: number,
  ): Promise<void> {
    const delivery = this.deliveries.get(claim.id);
    if (
      delivery?.status === "pending" &&
      delivery.generation === claim.generation &&
      delivery.availableAt !== null &&
      delivery.availableAt <= new Date()
    ) {
      delivery.failures += 1;
      delivery.generation += 1;
      delivery.availableAt = addMilliseconds(new Date(), delayMs);
      delivery.lastError = "Push delivery processing failed";
      if (delivery.failures >= maxFailures) delivery.status = "failed";
    }
    return Promise.resolve();
  }

  async startAttempt(
    { id, generation }: PushClaim,
    target: PushTarget,
    pendingTask: PendingPushTask,
  ) {
    const delivery = this.deliveries.get(id);

    if (delivery?.status !== "pending" || delivery.generation !== generation)
      return null;

    const task = this.tasks.get(delivery.taskId);
    if (task === undefined) return null;

    const now = new Date();
    const since = subHours(now, 1);
    const preferences = await this.pushRepository.preferencesOf(task.userId);
    if (remainingPushSeconds(task.createdAt, now) === 0) {
      delivery.status = "expired";
      return null;
    }
    const news = await this.pushRepository.newsOf(pendingTask);
    if (news === null) {
      delivery.status = "skipped";
      delivery.lastError = "The notification or message is no longer unread";
      return null;
    }
    const decision = decide(news.group, preferences, now);
    if (decision.kind === "skip") {
      delivery.status = "skipped";
      delivery.lastError = "Push group is muted";
      return null;
    }
    if (decision.kind === "wait") {
      await this.postponeDelivery({ id, generation }, decision.until);
      return null;
    }
    const retryAfter = this.retryAfter.get(target.endpoint);
    if (retryAfter && retryAfter > now) {
      await this.postponeDelivery(
        { id, generation },
        min([retryAfter, pushExpiresAt(task.createdAt)]),
      );
      return null;
    }
    const { hourlyLimit } = preferences;
    const recent = [...this.tasks.values()].filter(
      (other) =>
        other.userId === task.userId &&
        other.lastAttemptAt !== null &&
        other.lastAttemptAt > since,
    ).length;

    const reserved = task.lastAttemptAt !== null && task.lastAttemptAt > since;
    if (
      task.outcome === "limited" ||
      (!reserved && hourlyLimit !== null && recent >= hourlyLimit)
    ) {
      delivery.status = "skipped";
      delivery.lastError = "Hourly push limit reached";
      if (task.lastAttemptAt === null) task.outcome = "limited";
      return null;
    }

    const previousAttemptAt = delivery.lastAttemptAt;
    delivery.lastAttemptAt = now;
    delivery.attempts += 1;
    delivery.generation += 1;
    task.lastAttemptAt = now;

    return {
      attempts: delivery.attempts,
      generation: delivery.generation,
      previousAttemptAt,
      content: news.content,
      expiresInMs: differenceInMilliseconds(pushExpiresAt(task.createdAt), now),
    };
  }

  expireReservedAttempt(
    id: string,
    task: PendingPushTask,
    {
      generation,
      previousAttemptAt,
    }: { generation: number; previousAttemptAt: Date | null },
  ): Promise<void> {
    if (this.returnAttempt(id, task, { generation, previousAttemptAt })) {
      const delivery = this.deliveries.get(id);
      if (delivery) delivery.status = "expired";
    }
    return Promise.resolve();
  }

  /** The SQL's `returnAttempt`: the try and the task's place in the hourly limit. */
  private returnAttempt(
    id: string,
    task: PendingPushTask,
    {
      generation,
      previousAttemptAt,
    }: { generation: number; previousAttemptAt: Date | null },
  ): boolean {
    const delivery = this.deliveries.get(id);
    const stored = this.tasks.get(task.id);
    if (
      !stored ||
      delivery?.status !== "pending" ||
      delivery.generation !== generation
    )
      return false;

    delivery.attempts -= 1;
    delivery.lastAttemptAt = previousAttemptAt;
    stored.lastAttemptAt = [...this.deliveries.values()]
      .filter((row) => row.taskId === task.id)
      .reduce<Date | null>(
        (latest, row) =>
          row.lastAttemptAt && (!latest || row.lastAttemptAt > latest)
            ? row.lastAttemptAt
            : latest,
        null,
      );
    return true;
  }

  finishDelivery(
    id: string,
    status: PushDeliveryEnd,
    responseStatus: number | null | undefined,
    reason: string | null,
    { generation }: { generation: number },
  ) {
    const delivery = this.deliveries.get(id);

    if (delivery?.status !== "pending" || delivery.generation !== generation)
      return Promise.resolve();

    Object.assign(delivery, { status, lastError: reason });
    if (responseStatus !== undefined) delivery.responseStatus = responseStatus;

    if (status === "gone") {
      const target = this.pushRepository.subscriptions.find(
        (row) => row.id === delivery.subscriptionId,
      );

      if (target) return this.pushRepository.removeGone(target.endpoint);
    }

    return Promise.resolve();
  }

  /** The refusal alone: dropping a browser refused for a day is the SQL's, run by e2e. */
  forbidDelivery(
    id: string,
    responseStatus: number,
    { generation }: { generation: number },
  ) {
    const delivery = this.deliveries.get(id);

    if (delivery?.status === "pending" && delivery.generation === generation)
      Object.assign(delivery, {
        status: "rejected",
        responseStatus,
        lastError: "The push service refused the VAPID credentials",
      });

    return Promise.resolve();
  }

  retryDelivery(
    id: string,
    delayMs: number,
    responseStatus: number | null,
    reason: string,
    generation: number,
  ) {
    return this.reschedule(
      id,
      addMilliseconds(new Date(), delayMs),
      responseStatus,
      reason,
      generation,
    );
  }

  private reschedule(
    id: string,
    at: Date,
    responseStatus: number | null,
    reason: string,
    generation: number,
  ) {
    const delivery = this.deliveries.get(id);

    if (delivery?.status !== "pending" || delivery.generation !== generation)
      return Promise.resolve();

    Object.assign(delivery, {
      availableAt: at,
      responseStatus,
      lastError: reason,
      generation: generation + 1,
    });

    return Promise.resolve();
  }

  throttleDelivery(
    id: string,
    task: PendingPushTask,
    attempt: { generation: number; previousAttemptAt: Date | null },
    endpoint: string,
    pauseMs: number,
  ) {
    const until = addMilliseconds(new Date(), pauseMs);
    const deadline = max([this.retryAfter.get(endpoint) ?? until, until]);
    this.retryAfter.set(endpoint, deadline);

    if (!this.returnAttempt(id, task, attempt)) return Promise.resolve();

    return this.reschedule(
      id,
      min([deadline, pushExpiresAt(task.createdAt)]),
      429,
      "Throttled by the push service",
      attempt.generation,
    );
  }

  postponeDelivery({ id, generation }: PushClaim, at: Date) {
    const delivery = this.deliveries.get(id);

    if (delivery?.status === "pending" && delivery.generation === generation) {
      delivery.availableAt = at;
      delivery.generation += 1;
    }

    return Promise.resolve();
  }

  pruneFinished() {
    return Promise.resolve(0);
  }

  private finish(id: string, outcome: string, at: Date) {
    const task = this.tasks.get(id);

    if (task?.outcome !== null || task === undefined) return;

    task.outcome = outcome;
    task.finishedAt = at;
  }
}
