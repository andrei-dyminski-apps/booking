import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { addHours } from "date-fns";
import {
  ConversationSide,
  DEFAULT_PUSH_PREFERENCES,
  notificationSchema,
  pushGroupSchema,
  type Notification,
  type PushPreferences,
  type PushPreferencesPatch,
  type PushReceipt,
  type PushRegistration,
} from "@repo/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import {
  minutesOf,
  PUSH_ENDPOINT_HOLD_HOURS,
  pushGroupOf,
} from "../domain/push-policy";
import {
  messagePush,
  noticePush,
  type MessagePushSource,
  type PushNews,
} from "../application/push-content";
import { databaseNow } from "./database-clock";
import type { PendingPushTask } from "./push-outbox.repository";

/**
 * How many browsers one account is pushed to. Each push is a request to a push service per
 * browser, so the fan-out of one notice is bounded here; a browser past the cap loses its
 * subscription, the oldest first, and is offered it again on the profile page.
 */
export const MAX_PUSH_SUBSCRIPTIONS = 10;

export class InactivePushAccountError extends Error {}
export class PushSubscriptionReuseError extends Error {}

export const pushEndpointHash = (endpoint: string): string =>
  createHash("sha256").update(endpoint).digest("hex");

/**
 * Every query over `push_subscriptions` and `push_preferences`, the receipts the service
 * worker posts back, and the two reads a push is worded from: the notice and the message are
 * read here rather than through their own modules for the reason the mail repository reads
 * them — what a push needs of them is not what their screens need. The tasks and the
 * deliveries are `PushOutboxRepository`'s.
 */
@Injectable()
export class PushRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Renewals keep the same subscription, and so does a browser-managed replacement of the
   * endpoint: the tasks already written name the subscription's id. A provider may still
   * deliver pushes queued for an endpoint after its local row is removed, so another
   * account needs a new endpoint; the account those pushes were for may take it back.
   */
  async save(
    userId: string,
    { endpoint, keys, previousEndpoint }: PushRegistration,
    previousAuth?: string,
  ): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`push-endpoint:${endpoint}`}, 0))`;
      const owners = await tx.$queryRaw<{ id: string; active: boolean }[]>`
        SELECT id, blocked_at IS NULL AND deleted_at IS NULL AS active FROM users
        WHERE id = ${userId}::uuid
        FOR NO KEY UPDATE
      `;
      if (!owners.some((owner) => owner.id === userId && owner.active)) {
        if (previousAuth !== undefined) throw new PushSubscriptionReuseError();
        throw new InactivePushAccountError();
      }
      const now = await databaseNow(tx);
      const existing = await tx.pushSubscription.findUnique({
        where: { endpoint },
        select: { userId: true, p256dh: true, auth: true },
      });
      if (existing !== null && existing.userId !== userId) {
        throw new PushSubscriptionReuseError();
      }
      if (previousAuth !== undefined) {
        if (previousEndpoint === undefined)
          throw new PushSubscriptionReuseError();
        // A retry after a committed renewal must not create a second subscription.
        if (existing?.auth === keys.auth && existing.p256dh === keys.p256dh)
          return;

        const previous = await tx.pushSubscription.findUnique({
          where: { endpoint: previousEndpoint, userId, auth: previousAuth },
          select: { id: true },
        });
        if (
          previous === null ||
          (existing !== null && previousEndpoint !== endpoint)
        ) {
          throw new PushSubscriptionReuseError();
        }
      }

      const replaced =
        existing === null &&
        previousEndpoint !== undefined &&
        previousEndpoint !== endpoint
          ? await tx.pushSubscription.findFirst({
              where: { userId, endpoint: previousEndpoint },
              select: { id: true },
            })
          : null;
      if (existing === null) {
        if (previousEndpoint !== undefined && replaced === null) {
          throw new PushSubscriptionReuseError();
        }

        const endpointHash = pushEndpointHash(endpoint);
        const hold = await tx.pushEndpointHold.findUnique({
          where: { endpointHash },
          select: { userId: true, expiresAt: true },
        });
        if (hold !== null && hold.expiresAt > now && hold.userId !== userId)
          throw new PushSubscriptionReuseError();

        const expiresAt = addHours(now, PUSH_ENDPOINT_HOLD_HOURS);
        await tx.pushEndpointHold.upsert({
          where: { endpointHash },
          create: { endpointHash, userId, expiresAt },
          update: { userId, expiresAt },
        });
      }
      // New keys, or a new endpoint, restart the subscription's age — the cap's order and the
      // count of its `403`s; the same keys sent again leave both as they were.
      const keysChanged =
        existing === null ||
        existing.p256dh !== keys.p256dh ||
        existing.auth !== keys.auth;
      const renewal = {
        p256dh: keys.p256dh,
        auth: keys.auth,
        ...(keysChanged ? { createdAt: now } : {}),
      };
      if (replaced === null) {
        await tx.pushSubscription.upsert({
          where: { endpoint },
          create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
          update: renewal,
        });
      } else {
        await tx.pushSubscription.update({
          where: { id: replaced.id },
          data: { endpoint, ...renewal },
        });
      }

      if (previousEndpoint !== undefined && previousEndpoint !== endpoint) {
        await tx.pushSubscription.deleteMany({
          where: { userId, endpoint: previousEndpoint },
        });
      }

      const beyond = await tx.pushSubscription.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: MAX_PUSH_SUBSCRIPTIONS,
        select: { id: true },
      });

      if (beyond.length > 0) {
        await tx.pushSubscription.deleteMany({
          where: { id: { in: beyond.map(({ id }) => id) } },
        });
      }
    });
  }

  async hasSubscription(
    userId: string,
    endpoint: string,
    db: Prisma.TransactionClient = this.prismaService,
  ): Promise<boolean> {
    const subscription = await db.pushSubscription.findUnique({
      where: { endpoint, userId, user: { blockedAt: null, deletedAt: null } },
      select: { id: true },
    });

    return subscription !== null;
  }

  /** Scoped by the account: a browser's endpoint is not a key to anybody else's row. */
  async remove(userId: string, endpoint: string, auth?: string): Promise<void> {
    await this.prismaService.pushSubscription.deleteMany({
      where: { userId, endpoint, auth },
    });
  }

  /** What the account saved, or the defaults when it never saved anything. */
  async preferencesOf(
    userId: string,
    db: Prisma.TransactionClient = this.prismaService,
  ): Promise<PushPreferences> {
    const row = await db.pushPreference.findUnique({
      where: { userId },
    });

    if (row === null) return DEFAULT_PUSH_PREFERENCES;

    return {
      // Filtered rather than cast: a group retired from the contract is no longer muted.
      muted: pushGroupSchema.options.filter((group) =>
        row.mutedGroups.includes(group),
      ),
      quietHours:
        row.quietFrom === null || row.quietTo === null || row.timeZone === null
          ? null
          : {
              from: clockOf(row.quietFrom),
              to: clockOf(row.quietTo),
              timeZone: row.timeZone,
            },
      hourlyLimit: row.hourlyLimit,
    };
  }

  async savePreferences(
    userId: string,
    patch: PushPreferencesPatch,
  ): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
      const [active] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users
        WHERE id = ${userId}::uuid AND blocked_at IS NULL AND deleted_at IS NULL
        FOR NO KEY UPDATE
      `;
      if (active === undefined) throw new InactivePushAccountError();

      const previous = await this.preferencesOf(userId, tx);
      const muted = patch.muted ?? previous.muted;
      const quietHours =
        patch.quietHours === undefined ? previous.quietHours : patch.quietHours;
      const data = {
        mutedGroups: pushGroupSchema.options.filter((group) =>
          patch.groups?.[group] === undefined
            ? muted.includes(group)
            : !patch.groups[group],
        ),
        quietFrom: quietHours === null ? null : minutesOf(quietHours.from),
        quietTo: quietHours === null ? null : minutesOf(quietHours.to),
        timeZone: quietHours?.timeZone ?? null,
        hourlyLimit:
          patch.hourlyLimit === undefined
            ? previous.hourlyLimit
            : patch.hourlyLimit,
      };
      await tx.pushPreference.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });

      if (
        (previous.quietHours?.from ?? null) === (quietHours?.from ?? null) &&
        (previous.quietHours?.to ?? null) === (quietHours?.to ?? null) &&
        (previous.quietHours?.timeZone ?? null) === data.timeZone
      )
        return;

      const schedule = {
        availableAt: await databaseNow(tx),
        waitingForQuietHours: false,
        leasedUntil: null,
        generation: { increment: 1 },
      };
      await tx.pushTask.updateMany({
        where: { userId, outcome: null, waitingForQuietHours: true },
        data: schedule,
      });
      await tx.pushDelivery.updateMany({
        where: {
          task: { userId },
          status: "pending",
          waitingForQuietHours: true,
        },
        data: schedule,
      });
    });
  }

  /**
   * Stamps the moment once: a receipt posted twice — a retry of the worker's `fetch`, a
   * push delivered twice — keeps the first. A click says the push arrived too.
   */
  async recordReceipt({ id, event }: PushReceipt, at: Date): Promise<void> {
    await this.prismaService.pushDelivery.updateMany({
      where: { id, receivedAt: null },
      data: { receivedAt: at },
    });

    if (event === "clicked") {
      await this.prismaService.pushDelivery.updateMany({
        where: { id, clickedAt: null },
        data: { clickedAt: at },
      });
    }
  }

  async newsOf(
    task: PendingPushTask,
    db: Prisma.TransactionClient = this.prismaService,
  ): Promise<PushNews | null> {
    if (task.kind === "notice") {
      const notice = await this.unreadNotice(task.id, task.userId, db);

      return notice === null
        ? null
        : { group: pushGroupOf(notice.type), content: noticePush(notice) };
    }

    const message = await this.unreadMessage(task.id, db);

    return message === null || message.userId !== task.userId
      ? null
      : {
          group: "messages",
          content: {
            ...messagePush(message.source),
            messageAt: message.createdAt.getTime(),
          },
        };
  }

  private async unreadNotice(
    id: string,
    userId: string,
    db: Prisma.TransactionClient,
  ): Promise<Notification | null> {
    const row = await db.notification.findFirst({
      where: { id, userId, readAt: null },
    });

    if (row === null) return null;

    // Parsed rather than cast, for the reason `toNotification` gives: the column is `jsonb`.
    return notificationSchema.parse({
      id: row.id,
      type: row.type,
      data: row.data,
      readAt: null,
      createdAt: row.createdAt.toISOString(),
    });
  }

  /**
   * Who a message is news to and what to say: the side that did not write it, while that side
   * has not opened the thread past it and has not erased the account.
   */
  private async unreadMessage(
    id: string,
    db: Prisma.TransactionClient,
  ): Promise<{
    userId: string;
    source: MessagePushSource;
    createdAt: Date;
  } | null> {
    const message = await db.message.findUnique({
      where: { id },
      select: {
        body: true,
        sender: true,
        createdAt: true,
        conversation: {
          select: {
            id: true,
            guestId: true,
            guestReadAt: true,
            hostReadAt: true,
            guest: { select: { name: true, deletedAt: true } },
            listing: {
              select: {
                title: true,
                ownerId: true,
                owner: { select: { name: true, deletedAt: true } },
              },
            },
          },
        },
      },
    });

    if (message === null) return null;

    const { conversation } = message;
    const { guest, listing } = conversation;
    const toHost = message.sender === ConversationSide.GUEST;
    const recipient = toHost ? listing.owner : guest;
    const readAt = toHost ? conversation.hostReadAt : conversation.guestReadAt;

    if (recipient.deletedAt !== null) return null;
    if (readAt !== null && readAt >= message.createdAt) return null;

    return {
      userId: toHost ? listing.ownerId : conversation.guestId,
      createdAt: message.createdAt,
      source: {
        conversationId: conversation.id,
        senderName: (toHost ? guest : listing.owner).name,
        listingTitle: listing.title,
        body: message.body,
      },
    };
  }
}

/** The quiet hours are stored as minutes after midnight, the zone beside them. */
function clockOf(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
