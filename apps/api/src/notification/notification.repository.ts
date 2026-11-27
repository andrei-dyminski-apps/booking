import { Injectable } from "@nestjs/common";
import {
  notificationSchema,
  Role,
  type Notification,
  type NotificationContent,
  type NotificationQuery,
} from "@repo/contracts";
import type {
  Notification as NotificationRow,
  Prisma,
} from "../generated/prisma/client";
import { afterCreatedAt, CREATED_AT_ORDER, type Page } from "../common/paging";
import { PrismaService } from "../prisma/prisma.service";
import { countUnreadOfOne } from "../unread/unread.repository";
import type { UnreadCounts } from "../unread/unread.types";
import type { NotificationCursor } from "./notification-cursor";
import { groupOf } from "../mail/domain/mail-policy";
import { recordMailTask } from "../mail/infrastructure/mail-outbox.repository";
import { recordPushTask } from "../push/infrastructure/push-outbox.repository";

/**
 * Every query over `notifications`. Each one is scoped to the recipient by a `userId` in
 * its `where`, including the writes by id: a notification is only ever its recipient's,
 * so an id from somebody else's feed matches nothing — which is the `404` the service
 * answers — rather than being read first and refused after.
 *
 * **Every write that changes the unread count returns the counts it left**, taken in the
 * same transaction by `countUnreadOf` — which is where the lock and the revision that
 * orders them are explained.
 */
@Injectable()
export class NotificationRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * `null` when there is nobody to tell: the recipient's account is gone, or its owner
   * erased it. Erasing an account deletes its notices, and a notice is a copy of what was
   * true — a review's text, a listing's title — so writing new ones to it afterwards would go
   * on keeping what the erasure removed, on a row nobody will ever read.
   *
   * The recipient's row is read `FOR KEY SHARE` first, the lock the insert's foreign key
   * takes anyway, taken before the check rather than left to the insert: the erasure locks
   * the row `FOR UPDATE`, so a notice written alongside it either commits first and is
   * deleted with the rest, or waits and finds the account erased. A check inside the insert
   * itself would read the snapshot from before the erasure committed, and slip past it.
   */
  async create(
    userId: string,
    content: NotificationContent,
  ): Promise<{ notification: Notification; count: UnreadCounts } | null> {
    return this.prismaService.$transaction(async (tx) => {
      const recipient = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users
        WHERE id = ${userId}::uuid AND deleted_at IS NULL
        FOR KEY SHARE
      `;

      if (recipient.length === 0) return null;

      const notification = toNotification(
        await tx.notification.create({
          data: { userId, type: content.type, data: content.data },
        }),
      );
      if (groupOf(notification.type)) {
        await recordMailTask(tx, {
          kind: "notice",
          id: notification.id,
          userId,
        });
      }
      // Every notice is pushed, muting or not: what the account muted is read when it is sent.
      await recordPushTask(tx, { kind: "notice", id: notification.id, userId });

      return { notification, count: await countUnreadOfOne(tx, userId) };
    });
  }

  /**
   * Who hears what only a person can put right — the admins whose accounts are neither
   * blocked nor erased. A read of `users` rather than of this table, the one query here that is not
   * scoped to a recipient: it is what picks the recipients.
   */
  async findAdminIds(): Promise<string[]> {
    const rows = await this.prismaService.user.findMany({
      where: { role: Role.ADMIN, blockedAt: null, deletedAt: null },
      select: { id: true },
      orderBy: { id: "asc" },
    });

    return rows.map(({ id }) => id);
  }

  /** `limit + 1` rows, so the caller learns whether there is another page without a `count`. */
  async findPage(
    userId: string,
    query: NotificationQuery,
    cursor: NotificationCursor | null,
  ): Promise<Page<Notification>> {
    const rows = await this.prismaService.notification.findMany({
      where: {
        AND: [{ userId }, ...(cursor === null ? [] : [afterCreatedAt(cursor)])],
      },
      orderBy: CREATED_AT_ORDER.newest,
      take: query.limit + 1,
    });

    return {
      items: rows.slice(0, query.limit).map(toNotification),
      hasMore: rows.length > query.limit,
    };
  }

  /** Served by the partial index on `read_at IS NULL`, see the migration. */
  async countUnread(userId: string): Promise<UnreadCounts> {
    const { count } = await this.counted(userId, () => Promise.resolve());

    return count;
  }

  /**
   * `null` is a notification this recipient does not have. Reading one twice is not a
   * mistake — two tabs, or a click on a notice the bell already marked — so an already
   * read row answers its count too, keeps the moment it was first read, and reports that
   * nothing `changed`.
   */
  async markRead(
    userId: string,
    id: string,
  ): Promise<{ changed: boolean; count: UnreadCounts } | null> {
    const { result, count } = await this.counted(userId, async (tx) => {
      const { count: updated } = await tx.notification.updateMany({
        where: { id, userId, readAt: null },
        data: { readAt: new Date() },
      });

      if (updated > 0) return "changed";

      return (await tx.notification.count({ where: { id, userId } })) > 0
        ? "unchanged"
        : "missing";
    });

    return result === "missing"
      ? null
      : { changed: result === "changed", count };
  }

  /** `changed` is how many were unread a moment ago. */
  async markAllRead(
    userId: string,
  ): Promise<{ changed: number; count: UnreadCounts }> {
    const { result, count } = await this.counted(userId, async (tx) => {
      const { count: updated } = await tx.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
      });

      return updated;
    });

    return { changed: result, count };
  }

  /** `work`, then the counts it leaves, in one transaction. */
  private counted<T>(
    userId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<{ result: T; count: UnreadCounts }> {
    return this.prismaService.$transaction(async (tx) => {
      const result = await work(tx);

      return { result, count: await countUnreadOfOne(tx, userId) };
    });
  }
}

/**
 * The stored `data` is parsed against the contract rather than cast: the column is `jsonb`,
 * so nothing in the database holds it to the shape its `type` promises, and a row written
 * around the API — the seed, `psql`, an older version of this code — is untrusted input like
 * a cursor is. A row that fails is a drift, and throws.
 */
function toNotification(row: NotificationRow): Notification {
  return notificationSchema.parse({
    id: row.id,
    type: row.type,
    data: row.data,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}
