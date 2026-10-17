import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AccountUnread, UnreadCounts } from "./unread.types";

/** Namespaces the account's lock among whatever else takes an advisory lock one day. */
const UNREAD_LOCK_PREFIX = "unread:";

/**
 * The stream's opening `sync`: a count with no write before it, in a transaction of its
 * own. Everything that does write counts inside its own transaction with `countUnreadOf`.
 */
@Injectable()
export class UnreadRepository {
  constructor(private readonly prismaService: PrismaService) {}

  count(userId: string): Promise<UnreadCounts> {
    return this.prismaService.$transaction((tx) =>
      countUnreadOfOne(tx, userId),
    );
  }
}

/**
 * What every account in `userIds` has left unread, counted inside the caller's transaction
 * after whatever it wrote. The one place that says what "unread" is across both tables —
 * a notice with no `read_at`, a thread whose newest message is later than this side's
 * marker — so the bell, the messages and the opening `sync` cannot disagree about it.
 *
 * **Every count of an account is taken under that account's advisory lock**, held until the
 * caller commits. That serialises the counts of one account, which is what lets each carry
 * a `revision` that only grows, however many requests and instances of the API are writing
 * at once. The lock may come after the write: whichever of two writers takes it second
 * counts with the first one committed, and so reads both. What has to hold is that every
 * write which moves a count is followed by a count in its own transaction.
 *
 * Several accounts are locked in the order of their ids, so two messages crossing between
 * the same two people in two threads cannot each hold the lock the other is waiting for.
 * The callers that hold a row lock as well (a thread's `FOR UPDATE`) take it before these,
 * always in that order.
 */
export async function countUnreadOf(
  tx: Prisma.TransactionClient,
  userIds: readonly string[],
): Promise<AccountUnread[]> {
  const accounts = [...new Set(userIds)].sort();

  for (const userId of accounts) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${UNREAD_LOCK_PREFIX + userId}, 0))
    `;
  }

  const counted: AccountUnread[] = [];

  for (const userId of accounts) {
    counted.push({ userId, counts: await countLocked(tx, userId) });
  }

  return counted;
}

/** `countUnreadOf` for the one account a write touched. */
export async function countUnreadOfOne(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<UnreadCounts> {
  const [counted] = await countUnreadOf(tx, [userId]);

  if (counted === undefined) {
    throw new Error(`Nothing was counted for ${userId}`);
  }

  return counted.counts;
}

/** One row of the count — raw SQL, so the columns keep the names the `SELECT` gives them. */
type CountedRow = {
  notifications: number;
  conversations: number;
  revision: bigint;
};

/**
 * One statement for the whole count, run after the lock rather than with it: under `READ
 * COMMITTED` a statement reads the snapshot taken when it began, so a count in the statement
 * that waited for the lock would miss the commit it waited for.
 *
 * The revision is the database's own clock read under the lock, in microseconds: two
 * counts of one account cannot overlap, so the later one reads the later clock, and one
 * clock serves every instance of the API.
 *
 * The threads are counted in two subqueries for the reason `ConversationRepository.findPageFor`
 * reads them in two: the guest's half seeks its index, and an `OR` across `listings` would
 * scan every thread on the site. Unread is the newest message being later than the side's
 * own marker — the rule `toConversation` applies to one thread. The notices are served by
 * the partial index on `read_at IS NULL`.
 */
async function countLocked(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<UnreadCounts> {
  const [row] = await tx.$queryRaw<CountedRow[]>`
    SELECT
      (
        SELECT count(*) FROM notifications
        WHERE user_id = ${userId}::uuid AND read_at IS NULL
      )::int AS notifications,
      (
        (
          SELECT count(*) FROM conversations
          WHERE guest_id = ${userId}::uuid
            AND (guest_read_at IS NULL OR guest_read_at < last_message_at)
        ) + (
          SELECT count(*) FROM conversations c
          JOIN listings l ON l.id = c.listing_id
          WHERE l.owner_id = ${userId}::uuid
            AND (c.host_read_at IS NULL OR c.host_read_at < c.last_message_at)
        )
      )::int AS conversations,
      (extract(epoch FROM clock_timestamp()) * 1000000)::bigint AS revision
  `;

  if (row === undefined) {
    throw new Error(`Nothing was counted for ${userId}`);
  }

  return {
    notifications: row.notifications,
    conversations: row.conversations,
    revision: Number(row.revision),
  };
}
