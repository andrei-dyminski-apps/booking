import { Injectable } from "@nestjs/common";
import {
  notificationSchema,
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

  async create(
    userId: string,
    content: NotificationContent,
  ): Promise<{ notification: Notification; count: UnreadCounts }> {
    const { result, count } = await this.counted(userId, async (tx) =>
      toNotification(
        await tx.notification.create({
          data: { userId, type: content.type, data: content.data },
        }),
      ),
    );

    return { notification: result, count };
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
