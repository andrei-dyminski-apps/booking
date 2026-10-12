import { Injectable } from "@nestjs/common";
import {
  notificationSchema,
  type Notification,
  type NotificationContent,
  type NotificationQuery,
  type UnreadCount,
} from "@repo/contracts";
import type {
  Notification as NotificationRow,
  Prisma,
} from "../generated/prisma/client";
import { afterCreatedAt, CREATED_AT_ORDER, type Page } from "../common/paging";
import { PrismaService } from "../prisma/prisma.service";
import type { NotificationCursor } from "./notification-cursor";

/** Namespaces the account's lock among whatever else takes an advisory lock one day. */
const UNREAD_LOCK_PREFIX = "notifications:unread:";

/**
 * Every query over `notifications`. Each one is scoped to the recipient by a `userId` in
 * its `where`, including the writes by id: a notification is only ever its recipient's,
 * so an id from somebody else's feed matches nothing — which is the `404` the service
 * answers — rather than being read first and refused after.
 *
 * **Every write that changes the unread count returns the count it left**, and every count
 * is taken under a per-account advisory lock together with the write before it. That
 * serialises the counts of one account, which is what lets each carry a `revision` that
 * only grows — see `unreadRevisionSchema` in the contract — however many requests and
 * instances of the API are writing at once.
 */
@Injectable()
export class NotificationRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async create(
    userId: string,
    content: NotificationContent,
  ): Promise<{ notification: Notification; count: UnreadCount }> {
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
  async countUnread(userId: string): Promise<UnreadCount> {
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
  ): Promise<{ changed: boolean; count: UnreadCount } | null> {
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
  ): Promise<{ changed: number; count: UnreadCount }> {
    const { result, count } = await this.counted(userId, async (tx) => {
      const { count: updated } = await tx.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
      });

      return updated;
    });

    return { changed: result, count };
  }

  /**
   * `work`, then the count it leaves, in one transaction holding the account's advisory
   * lock — released by the commit, so nothing here can leave it held. The revision is the
   * database's own clock read under that lock, in microseconds: two counts of one account
   * cannot overlap, so the later one reads the later clock, and one clock serves every
   * instance of the API.
   */
  private counted<T>(
    userId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<{ result: T; count: UnreadCount }> {
    return this.prismaService.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${UNREAD_LOCK_PREFIX + userId}, 0))
      `;

      const result = await work(tx);
      const unread = await tx.notification.count({
        where: { userId, readAt: null },
      });
      const [clock] = await tx.$queryRaw<{ revision: bigint }[]>`
        SELECT (extract(epoch FROM clock_timestamp()) * 1000000)::bigint AS revision
      `;

      if (clock === undefined) {
        throw new Error("The database did not answer its clock");
      }

      return { result, count: { unread, revision: Number(clock.revision) } };
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
