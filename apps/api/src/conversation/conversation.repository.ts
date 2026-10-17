import { Injectable } from "@nestjs/common";
import { addMilliseconds, max } from "date-fns";
import {
  ConversationSide,
  type Conversation,
  type ConversationQuery,
  type Message,
  type MessageQuery,
  type StartConversationInput,
} from "@repo/contracts";
import { afterCreatedAt, CREATED_AT_ORDER, type Page } from "../common/paging";
import {
  type Prisma,
  type Conversation as ConversationRow,
  type Message as MessageRow,
} from "../generated/prisma/client";
import { STILL_OFFERED } from "../listing/listing.repository";
import { isPrismaError, PrismaErrorCode } from "../prisma/prisma.errors";
import { PrismaService } from "../prisma/prisma.service";
import { countUnreadOf, countUnreadOfOne } from "../unread/unread.repository";
import type { AccountUnread, UnreadCounts } from "../unread/unread.types";
import type { ConversationCursor, MessageCursor } from "./conversation-cursor";

/**
 * The listing a thread is being started about is not on offer: it never existed, or it was
 * retired. A thread that already exists outlives its listing; a new one cannot begin there.
 */
export class ListingNotFoundError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} not found`);
    this.name = "ListingNotFoundError";
  }
}

/**
 * The guest would be writing to themselves. Only a `USER` may start a thread, and only an
 * `OWNER` may create a listing — but a role changes and the listings stay, so a demoted
 * owner still owns what they published.
 */
export class OwnListingError extends Error {
  constructor(listingId: string) {
    super(`Listing ${listingId} is your own`);
    this.name = "OwnListingError";
  }
}

/**
 * The account behind the token is gone: nothing checks that row beforehand, because
 * `JwtStrategy` reads no database. The same case `BookingRepository` names for a stay.
 */
export class GuestNotFoundError extends Error {
  constructor(guestId: string) {
    super(`Guest ${guestId} not found`);
    this.name = "GuestNotFoundError";
  }
}

/**
 * The thread a message is being written to is gone — it went with its guest's account
 * between the read that authorized the write and the write itself.
 */
export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation ${conversationId} not found`);
    this.name = "ConversationNotFoundError";
  }
}

/**
 * Who the two people of a thread are, which is everything the authorization rules need and
 * nothing the contract carries: the host is read through the listing rather than stored,
 * so it is always whoever owns it now.
 */
export type ConversationParticipants = {
  guestId: string;
  hostId: string;
};

/**
 * What every read of a thread selects beside its own columns: the title of the listing —
 * not narrowed by `deleted_at`, because a thread outlives the offer exactly as a stay does
 * — and the names of its two people. Names only: neither side's address is the other's to
 * read, and `toConversation` copies the fields by name so nothing else selected here can
 * leak out. The newest message is not among them: it is a column of the thread
 * (`last_message_*`), because a relation read with `take: 1` over a page of threads loads
 * every message of every one of them.
 */
const CONVERSATION_INCLUDE = {
  listing: { select: { title: true, owner: { select: { name: true } } } },
  guest: { select: { name: true } },
} satisfies Prisma.ConversationInclude;

/**
 * A message as it was written, and what each side of its thread has left unread after it —
 * both sides, because sending stamps the sender's own marker too.
 */
export type AppendedMessage = {
  message: Message;
  unread: AccountUnread[];
};

type ConversationRowWithSummary = ConversationRow & {
  listing: { title: string; owner: { name: string } };
  guest: { name: string };
};

/**
 * Every query over `conversations` and `messages`. The two tables are one entity — a
 * message never exists outside its thread, and writing one moves the thread's
 * `last_message_at` and its sender's read marker in the same transaction — so they share a
 * repository rather than getting one apiece.
 *
 * Every write that moves a read marker or the newest message counts what its people have
 * left unread in the same transaction (`countUnreadOf`), after the thread's row lock.
 */
@Injectable()
export class ConversationRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Every thread this account is a side of: the ones it started as a guest and the ones
   * about its listings, retired listings included — a guest who wrote before the listing
   * was withdrawn is still owed an answer. Both halves whatever the role, because the
   * sides are fixed by the rows: an account promoted to `OWNER` keeps the threads it
   * started as a guest, and one demoted to `USER` still owns its listings.
   *
   * The two halves are read apart and merged here, not as one `guest_id = $1 OR
   * listings.owner_id = $1`: Postgres seeks no index through an `OR` whose second branch
   * is a column of another table, so that query joins and scans every thread on the site
   * — measured at 520k threads, 25 ms for a guest with seven of them, against 0.05 ms for
   * the guest half alone on `(guest_id, last_message_at DESC, id DESC)`. Apart, the guest
   * half is that seek and the host half costs what the host's own threads cost, as the
   * owner's scope of the stays does.
   *
   * Both halves are cut by the same cursor and ordering and read `limit + 1` rows, so the
   * first `limit + 1` of their union are among those — which is the page and its
   * `hasMore`. The halves never share a thread (nobody starts one about their own
   * listing, and a listing does not change hands); the merge drops a repeated id anyway,
   * because the page would otherwise show a row twice.
   *
   * In each half the scope, the filter and the cursor are three conditions of one `AND`,
   * for the reason `BookingRepository.findPage` gives: a filter may narrow the scope and
   * never replace it.
   */
  async findPageFor(
    userId: string,
    query: ConversationQuery,
    cursor: ConversationCursor | null,
  ): Promise<Page<Conversation>> {
    const half = (scope: Prisma.ConversationWhereInput) =>
      this.prismaService.conversation.findMany({
        where: {
          AND: [
            scope,
            { listingId: query.listingId },
            ...(cursor === null ? [] : [afterCursor(cursor)]),
          ],
        },
        include: CONVERSATION_INCLUDE,
        orderBy: ORDER_BY,
        take: query.limit + 1,
      });

    const [asGuest, asHost] = await Promise.all([
      half({ guestId: userId }),
      half({ listing: { ownerId: userId } }),
    ]);
    const rows = [
      ...new Map([...asGuest, ...asHost].map((row) => [row.id, row])).values(),
    ]
      .sort(newestFirst)
      .slice(0, query.limit + 1);

    return {
      items: rows
        .slice(0, query.limit)
        .map((row) =>
          toConversation(
            row,
            row.guestId === userId
              ? ConversationSide.GUEST
              : ConversationSide.HOST,
          ),
        ),
      hasMore: rows.length > query.limit,
    };
  }

  async findParticipants(id: string): Promise<ConversationParticipants | null> {
    const row = await this.prismaService.conversation.findUnique({
      where: { id },
      select: { guestId: true, listing: { select: { ownerId: true } } },
    });

    return row === null
      ? null
      : { guestId: row.guestId, hostId: row.listing.ownerId };
  }

  async findById(
    id: string,
    side: ConversationSide,
  ): Promise<Conversation | null> {
    const row = await this.prismaService.conversation.findUnique({
      where: { id },
      include: CONVERSATION_INCLUDE,
    });

    return row === null ? null : toConversation(row, side);
  }

  /**
   * Opens the thread between this guest and the listing's host, or continues the one they
   * already have, with the message that is the reason for either. One per pair, enforced by
   * the unique index: Prisma issues this upsert as one `INSERT ... ON CONFLICT DO UPDATE`,
   * so a second first message sent at once waits for the first one's commit and then
   * writes into the same thread rather than failing on the key.
   *
   * The listing is read inside the transaction, narrowed by `STILL_OFFERED` — a thread may
   * outlive its listing but cannot begin after it.
   */
  async start(
    guestId: string,
    input: StartConversationInput,
  ): Promise<AppendedMessage & { conversation: Conversation }> {
    try {
      return await this.prismaService.$transaction(async (tx) => {
        const listing = await tx.listing.findFirst({
          where: { id: input.listingId, ...STILL_OFFERED },
          select: { ownerId: true },
        });

        if (listing === null) {
          throw new ListingNotFoundError(input.listingId);
        }

        if (listing.ownerId === guestId) {
          throw new OwnListingError(input.listingId);
        }

        // The message below writes all three `last_message_*` under the lock, inside this
        // transaction, before anybody else can read the row; what the upsert writes there
        // only has to satisfy `NOT NULL`. `update` must not be empty all the same: Prisma
        // issues `ON CONFLICT` only for an upsert that updates something, and an empty one
        // becomes a `SELECT` and an `INSERT` that a concurrent first message fails on with
        // `P2002`. The moment is left to the locked append, which never moves it backwards.
        const { id } = await tx.conversation.upsert({
          where: {
            listingId_guestId: { listingId: input.listingId, guestId },
          },
          create: {
            listingId: input.listingId,
            guestId,
            lastMessageAt: new Date(),
            lastMessageBody: input.body,
            lastMessageSender: ConversationSide.GUEST,
          },
          update: {
            lastMessageBody: input.body,
            lastMessageSender: ConversationSide.GUEST,
          },
          select: { id: true },
        });

        const { message } = await appendIn(
          tx,
          id,
          ConversationSide.GUEST,
          input.body,
        );

        const row = await tx.conversation.findUniqueOrThrow({
          where: { id },
          include: CONVERSATION_INCLUDE,
        });

        return {
          conversation: toConversation(row, ConversationSide.GUEST),
          message,
          unread: await countUnreadOf(tx, [guestId, listing.ownerId]),
        };
      });
    } catch (error) {
      // The listing was read a moment ago, so the one key left to give way is the guest's.
      if (isPrismaError(error, PrismaErrorCode.ForeignKeyViolation)) {
        throw new GuestNotFoundError(guestId);
      }

      throw error;
    }
  }

  /**
   * One message from either side — see `appendIn` for what it moves and why it locks, and
   * for the two people it reads under that lock.
   */
  append(
    conversationId: string,
    sender: ConversationSide,
    body: string,
  ): Promise<AppendedMessage> {
    return this.prismaService.$transaction(async (tx) => {
      const { message, participants } = await appendIn(
        tx,
        conversationId,
        sender,
        body,
      );

      return {
        message,
        unread: await countUnreadOf(tx, [
          participants.guestId,
          participants.hostId,
        ]),
      };
    });
  }

  /**
   * The side has seen the thread up to `upTo` — the newest message its screen showed. The
   * marker only moves forwards, and never past the thread's newest message: a moment later
   * than that names nothing a screen could have shown, so it is a no-op rather than a
   * marker that would swallow the next message unread.
   *
   * `null` when the marker did not move — the thread was read already, or the moment names
   * nothing newer — and otherwise the reader's counts after it.
   */
  markRead(
    conversationId: string,
    side: ConversationSide,
    upTo: Date,
    readerId: string,
  ): Promise<UnreadCounts | null> {
    return this.prismaService.$transaction(async (tx) => {
      // `updateMany`, so a thread that went with its guest's account between the read that
      // authorized this and here is a no-op rather than a 500.
      const { count } = await tx.conversation.updateMany({
        where: {
          id: conversationId,
          lastMessageAt: { gte: upTo },
          ...readBefore(side, upTo),
        },
        data: readUpTo(side, upTo),
      });

      if (count === 0) return null;

      return countUnreadOfOne(tx, readerId);
    });
  }

  /** One page of a thread, the newest message first. */
  async findMessagePage(
    conversationId: string,
    query: MessageQuery,
    cursor: MessageCursor | null,
  ): Promise<Page<Message>> {
    const rows = await this.prismaService.message.findMany({
      where: {
        AND: [
          { conversationId },
          ...(cursor === null ? [] : [afterCreatedAt(cursor)]),
        ],
      },
      orderBy: CREATED_AT_ORDER.newest,
      take: query.limit + 1,
    });

    return {
      items: rows.slice(0, query.limit).map(toMessage),
      hasMore: rows.length > query.limit,
    };
  }
}

/**
 * One message, and the columns of its thread it moves: the thread's newest message is now
 * this one — its moment, its text and its side — and the sender has read everything up to
 * it.
 *
 * The thread row is locked first (`SELECT ... FOR UPDATE`), and the moment is taken only
 * after the lock is held, one millisecond past the thread's newest message at the least.
 * Two messages of one thread are therefore written one after the other, each later than
 * the last: without the lock, a reply whose clock read came first but whose commit came
 * second would set `last_message_at` back past the other side's message — the newest
 * message would read as already seen, and the list's cursor, written from the message,
 * would no longer match the column it is compared against. The millisecond is the column's
 * precision: two messages in one would leave a marker equal to the newer one, which reads
 * as seen.
 *
 * The two people of the thread are read by the same query as its newest moment — the host
 * through the listing, as everywhere else — so whoever counts after the message has them
 * without asking again.
 */
async function appendIn(
  tx: Prisma.TransactionClient,
  conversationId: string,
  sender: ConversationSide,
  body: string,
): Promise<{ message: Message; participants: ConversationParticipants }> {
  const locked = await tx.$queryRaw<LockedConversation[]>`
    SELECT id FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE
  `;

  if (locked[0] === undefined) {
    throw new ConversationNotFoundError(conversationId);
  }

  const { lastMessageAt, guestId, listing } =
    await tx.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: {
        lastMessageAt: true,
        guestId: true,
        listing: { select: { ownerId: true } },
      },
    });
  const at = max([new Date(), addMilliseconds(lastMessageAt, 1)]);

  const row = await tx.message.create({
    data: { conversationId, sender, body, createdAt: at },
  });

  await tx.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: at,
      lastMessageBody: body,
      lastMessageSender: sender,
      ...readUpTo(sender, at),
    },
  });

  return {
    message: toMessage(row),
    participants: { guestId, hostId: listing.ownerId },
  };
}

/** One row of the `FOR UPDATE` read — raw SQL, so the column keeps its stored name. */
type LockedConversation = { id: string };

/**
 * The most recently written-to thread first, the id behind it — the pair the index on
 * `(guest_id, last_message_at DESC, id DESC)` is built on and the cursor carries.
 */
const ORDER_BY: Prisma.ConversationOrderByWithRelationInput[] = [
  { lastMessageAt: "desc" },
  { id: "desc" },
];

/**
 * `ORDER_BY` in JavaScript, for merging two pages read under it. A uuid compares as its
 * lower-case text compares — the hex digits are in the byte order Postgres sorts by.
 */
function newestFirst(
  left: Pick<ConversationRow, "lastMessageAt" | "id">,
  right: Pick<ConversationRow, "lastMessageAt" | "id">,
): number {
  const byMoment = right.lastMessageAt.getTime() - left.lastMessageAt.getTime();

  if (byMoment !== 0) return byMoment;

  return right.id < left.id ? -1 : right.id > left.id ? 1 : 0;
}

/**
 * Everything after the cursor row. The key is said twice, and the inclusive half is the
 * one the index uses — see `afterCursor` in `listing.repository.ts`.
 */
function afterCursor(
  cursor: ConversationCursor,
): Prisma.ConversationWhereInput {
  return {
    lastMessageAt: { lte: cursor.lastMessageAt },
    OR: [
      { lastMessageAt: { lt: cursor.lastMessageAt } },
      { lastMessageAt: cursor.lastMessageAt, id: { lt: cursor.id } },
    ],
  };
}

/** The write that says this side has seen the thread up to `at`. */
function readUpTo(
  side: ConversationSide,
  at: Date,
): { guestReadAt: Date } | { hostReadAt: Date } {
  switch (side) {
    case ConversationSide.GUEST:
      return { guestReadAt: at };
    case ConversationSide.HOST:
      return { hostReadAt: at };
  }
}

/** The condition under which `readUpTo(side, at)` moves this side's marker forwards. */
function readBefore(
  side: ConversationSide,
  at: Date,
): Prisma.ConversationWhereInput {
  switch (side) {
    case ConversationSide.GUEST:
      return { OR: [{ guestReadAt: null }, { guestReadAt: { lt: at } }] };
    case ConversationSide.HOST:
      return { OR: [{ hostReadAt: null }, { hostReadAt: { lt: at } }] };
  }
}

/** When this side last opened the thread, or `null` for never. */
function readMarkerOf(
  row: ConversationRow,
  side: ConversationSide,
): Date | null {
  switch (side) {
    case ConversationSide.GUEST:
      return row.guestReadAt;
    case ConversationSide.HOST:
      return row.hostReadAt;
  }
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    sender: row.sender,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A thread as one of its two sides reads it. Unread is "the newest message is later than
 * this side last looked"; a side that never looked has everything to read. Sending stamps
 * the sender's own marker, which is what keeps one's own message from reading as news.
 */
function toConversation(
  row: ConversationRowWithSummary,
  side: ConversationSide,
): Conversation {
  const readAt = readMarkerOf(row, side);

  return {
    id: row.id,
    listingId: row.listingId,
    listing: { title: row.listing.title },
    guestId: row.guestId,
    guest: { name: row.guest.name },
    host: { name: row.listing.owner.name },
    side,
    lastMessage: {
      sender: row.lastMessageSender,
      body: row.lastMessageBody,
      createdAt: row.lastMessageAt.toISOString(),
    },
    unread: readAt === null || readAt < row.lastMessageAt,
    createdAt: row.createdAt.toISOString(),
  };
}
