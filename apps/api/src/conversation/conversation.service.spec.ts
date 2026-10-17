import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import {
  conversationQuerySchema,
  ConversationSide,
  messageQuerySchema,
  Role,
  type Conversation,
  type ConversationQuery,
  type Message,
  type MessageQuery,
  type ServerEvent,
  type StartConversationInput,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { Page } from "../common/paging";
import { RealtimeService } from "../realtime/realtime.service";
import type { AccountUnread, UnreadCounts } from "../unread/unread.types";
import {
  type AppendedMessage,
  ConversationNotFoundError,
  ConversationRepository,
  GuestNotFoundError,
  ListingNotFoundError,
  OwnListingError,
  type ConversationParticipants,
} from "./conversation.repository";
import type { ConversationCursor, MessageCursor } from "./conversation-cursor";
import { ConversationService } from "./conversation.service";

const GUEST_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OTHER_GUEST_ID = "4b5c6d7e-8f90-4a1b-9c2d-3e4f5a6b7c8d";
const OWNER_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
const OTHER_OWNER_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const STRANGER_ID = "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50";
const LISTING_ID = "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
const OTHER_LISTING_ID = "3a4b5c6d-7e8f-4091-8a2b-3c4d5e6f7a8b";
const RETIRED_LISTING_ID = "8f9a0b1c-2d3e-4f50-8a6b-7c8d9e0f1a2b";

const userWith = (id: string, role: Role): AuthenticatedUser => ({
  id,
  email: "someone@example.com",
  role,
});

const guest = userWith(GUEST_ID, Role.USER);
const otherGuest = userWith(OTHER_GUEST_ID, Role.USER);
const owner = userWith(OWNER_ID, Role.OWNER);
const otherOwner = userWith(OTHER_OWNER_ID, Role.OWNER);
const stranger = userWith(STRANGER_ID, Role.USER);
const admin = userWith(STRANGER_ID, Role.ADMIN);

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

const threadsFor = (search: Record<string, string> = {}): ConversationQuery =>
  conversationQuerySchema.parse(search);

const messagesFor = (search: Record<string, string> = {}): MessageQuery =>
  messageQuerySchema.parse(search);

const about = (listingId: string, body = "Hello"): StartConversationInput => ({
  listingId,
  body,
});

type StoredThread = ConversationParticipants & {
  id: string;
  listingId: string;
  createdAt: Date;
  lastMessageAt: Date;
  guestReadAt: Date | null;
  hostReadAt: Date | null;
};

/**
 * Threads and their messages in memory. What this fake has to get right is the shape the
 * service reasons about: one thread per guest and listing, a host read through the
 * listing, a read marker per side that sending stamps for the sender. The queries, the
 * transaction and the ordering by `last_message_at` are the e2e spec's half.
 */
class FakeConversationRepository implements PublicOf<ConversationRepository> {
  readonly threads = new Map<string, StoredThread>();
  readonly messages: Message[] = [];

  /** Who owns each listing, and whether it is still offered. */
  readonly listings = new Map<string, { ownerId: string; offered: boolean }>([
    [LISTING_ID, { ownerId: OWNER_ID, offered: true }],
    [OTHER_LISTING_ID, { ownerId: OTHER_OWNER_ID, offered: true }],
    [RETIRED_LISTING_ID, { ownerId: OWNER_ID, offered: false }],
  ]);

  /** Set to have `start` fail on the guest key: the account behind the token is gone. */
  vanishingGuest = false;

  /** Every write gets a moment of its own, so the orderings are never left to the id. */
  private clock = Date.parse("2026-08-17T12:00:00.000Z");

  /** The fake's revision: every count is one tick later than the last, as under the real lock. */
  private revision = 0;

  findPageFor(
    userId: string,
    query: ConversationQuery,
    cursor: ConversationCursor | null,
  ): Promise<Page<Conversation>> {
    const matching = [...this.threads.values()]
      .filter((thread) => thread.guestId === userId || thread.hostId === userId)
      .filter(
        (thread) =>
          query.listingId === undefined || thread.listingId === query.listingId,
      )
      .sort(
        (left, right) =>
          right.lastMessageAt.getTime() - left.lastMessageAt.getTime(),
      );
    const start =
      cursor === null
        ? 0
        : matching.findIndex((thread) => thread.id === cursor.id) + 1;

    return Promise.resolve({
      items: matching
        .slice(start, start + query.limit)
        .map((thread) =>
          this.toConversation(
            thread,
            thread.guestId === userId
              ? ConversationSide.GUEST
              : ConversationSide.HOST,
          ),
        ),
      hasMore: matching.length > start + query.limit,
    });
  }

  findParticipants(id: string): Promise<ConversationParticipants | null> {
    const thread = this.threads.get(id);

    return Promise.resolve(
      thread === undefined
        ? null
        : { guestId: thread.guestId, hostId: thread.hostId },
    );
  }

  findById(id: string, side: ConversationSide): Promise<Conversation | null> {
    const thread = this.threads.get(id);

    return Promise.resolve(
      thread === undefined ? null : this.toConversation(thread, side),
    );
  }

  start(
    guestId: string,
    input: StartConversationInput,
  ): Promise<AppendedMessage & { conversation: Conversation }> {
    const listing = this.listings.get(input.listingId);

    if (listing === undefined || !listing.offered) {
      return Promise.reject(new ListingNotFoundError(input.listingId));
    }

    if (listing.ownerId === guestId) {
      return Promise.reject(new OwnListingError(input.listingId));
    }

    if (this.vanishingGuest) {
      return Promise.reject(new GuestNotFoundError(guestId));
    }

    const now = this.tick();
    const existing = [...this.threads.values()].find(
      (thread) =>
        thread.listingId === input.listingId && thread.guestId === guestId,
    );
    const thread: StoredThread = existing ?? {
      id: randomUUID(),
      listingId: input.listingId,
      guestId,
      hostId: listing.ownerId,
      createdAt: now,
      lastMessageAt: now,
      guestReadAt: null,
      hostReadAt: null,
    };

    this.threads.set(thread.id, thread);

    const message = this.write(thread, ConversationSide.GUEST, input.body, now);

    return Promise.resolve({
      conversation: this.toConversation(thread, ConversationSide.GUEST),
      message,
      unread: this.unreadOf(thread),
    });
  }

  append(
    conversationId: string,
    sender: ConversationSide,
    body: string,
  ): Promise<AppendedMessage> {
    const thread = this.threads.get(conversationId);

    if (thread === undefined) {
      return Promise.reject(new ConversationNotFoundError(conversationId));
    }

    const message = this.write(thread, sender, body, this.tick());

    return Promise.resolve({ message, unread: this.unreadOf(thread) });
  }

  markRead(
    conversationId: string,
    side: ConversationSide,
    upTo: Date,
    readerId: string,
  ): Promise<UnreadCounts | null> {
    const thread = this.threads.get(conversationId);
    const marker =
      side === ConversationSide.GUEST ? "guestReadAt" : "hostReadAt";

    // Forwards only, and never past the newest message — the repository's two conditions.
    if (
      thread !== undefined &&
      upTo <= thread.lastMessageAt &&
      (thread[marker] === null || thread[marker] < upTo)
    ) {
      thread[marker] = upTo;

      return Promise.resolve(this.countOf(readerId));
    }

    return Promise.resolve(null);
  }

  findMessagePage(
    conversationId: string,
    query: MessageQuery,
    cursor: MessageCursor | null,
  ): Promise<Page<Message>> {
    const matching = this.messages
      .filter((message) => message.conversationId === conversationId)
      .reverse();
    const start =
      cursor === null
        ? 0
        : matching.findIndex((message) => message.id === cursor.id) + 1;

    return Promise.resolve({
      items: matching.slice(start, start + query.limit),
      hasMore: matching.length > start + query.limit,
    });
  }

  private write(
    thread: StoredThread,
    sender: ConversationSide,
    body: string,
    at: Date,
  ): Message {
    const message: Message = {
      id: randomUUID(),
      conversationId: thread.id,
      sender,
      body,
      createdAt: at.toISOString(),
    };

    this.messages.push(message);
    thread.lastMessageAt = at;
    thread[sender === ConversationSide.GUEST ? "guestReadAt" : "hostReadAt"] =
      at;

    return message;
  }

  private toConversation(
    thread: StoredThread,
    side: ConversationSide,
  ): Conversation {
    const last = this.messages.findLast(
      (message) => message.conversationId === thread.id,
    );

    if (last === undefined) throw new Error(`No messages in ${thread.id}`);

    const readAt =
      side === ConversationSide.GUEST ? thread.guestReadAt : thread.hostReadAt;

    return {
      id: thread.id,
      listingId: thread.listingId,
      listing: { title: "Loft above the harbour" },
      guestId: thread.guestId,
      // The names are the repository's to resolve; no rule of the service reads them.
      guest: { name: `Guest ${thread.guestId}` },
      host: { name: `Host ${thread.hostId}` },
      side,
      lastMessage: {
        sender: last.sender,
        body: last.body,
        createdAt: last.createdAt,
      },
      unread: readAt === null || readAt < thread.lastMessageAt,
      createdAt: thread.createdAt.toISOString(),
    };
  }

  private unreadOf(thread: StoredThread): AccountUnread[] {
    return [thread.guestId, thread.hostId].map((userId) => ({
      userId,
      counts: this.countOf(userId),
    }));
  }

  /** No notices here: what they add to the counts is `NotificationService`'s to test. */
  private countOf(userId: string): UnreadCounts {
    this.revision += 1;

    const conversations = [...this.threads.values()].filter((thread) => {
      const readAt =
        thread.guestId === userId
          ? thread.guestReadAt
          : thread.hostId === userId
            ? thread.hostReadAt
            : thread.lastMessageAt;

      return readAt === null || readAt < thread.lastMessageAt;
    }).length;

    return { notifications: 0, conversations, revision: this.revision };
  }

  private tick(): Date {
    this.clock += 1_000;

    return new Date(this.clock);
  }
}

/** Records what reached each account's channel. */
class FakeRealtimeService implements Pick<RealtimeService, "publish"> {
  readonly published: { userId: string; event: ServerEvent }[] = [];

  publish(userId: string, event: ServerEvent): Promise<void> {
    this.published.push({ userId, event });

    return Promise.resolve();
  }
}

describe("ConversationService", () => {
  let service: ConversationService;
  let conversationRepository: FakeConversationRepository;
  let realtimeService: FakeRealtimeService;

  beforeEach(async () => {
    conversationRepository = new FakeConversationRepository();
    realtimeService = new FakeRealtimeService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationService,
        { provide: ConversationRepository, useValue: conversationRepository },
        { provide: RealtimeService, useValue: realtimeService },
      ],
    }).compile();

    service = moduleRef.get(ConversationService);
  });

  describe("start", () => {
    it("opens a thread the guest has read and the host has not", async () => {
      const started = await service.start(GUEST_ID, about(LISTING_ID));

      expect(started).toMatchObject({
        side: ConversationSide.GUEST,
        unread: false,
        lastMessage: { sender: ConversationSide.GUEST, body: "Hello" },
      });
      await expect(service.findOne(started.id, owner)).resolves.toMatchObject({
        side: ConversationSide.HOST,
        unread: true,
      });
    });

    it("continues the thread a guest already has about the same listing", async () => {
      const first = await service.start(GUEST_ID, about(LISTING_ID, "One"));
      const second = await service.start(GUEST_ID, about(LISTING_ID, "Two"));

      expect(second.id).toBe(first.id);
      expect(second.lastMessage.body).toBe("Two");
      expect(conversationRepository.threads.size).toBe(1);
    });

    it("answers a listing that is not on offer with a 404", async () => {
      await expect(
        service.start(GUEST_ID, about(RETIRED_LISTING_ID)),
      ).rejects.toThrow(NotFoundException);
    });

    it("refuses a guest writing about a listing of their own", async () => {
      await expect(service.start(OWNER_ID, about(LISTING_ID))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("answers a guest whose account is gone as an ended session", async () => {
      conversationRepository.vanishingGuest = true;

      await expect(service.start(GUEST_ID, about(LISTING_ID))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("findPage", () => {
    it("scopes a guest to their threads and a host to their listings'", async () => {
      const mine = await service.start(GUEST_ID, about(LISTING_ID));
      const theirs = await service.start(OTHER_GUEST_ID, about(LISTING_ID));
      const elsewhere = await service.start(GUEST_ID, about(OTHER_LISTING_ID));

      const ids = async (user: AuthenticatedUser): Promise<string[]> =>
        (await service.findPage(user, threadsFor())).items.map(
          (thread) => thread.id,
        );

      expect(await ids(guest)).toEqual([elsewhere.id, mine.id]);
      expect(await ids(otherGuest)).toEqual([theirs.id]);
      expect(await ids(owner)).toEqual([theirs.id, mine.id]);
      expect(await ids(otherOwner)).toEqual([elsewhere.id]);
    });

    it("keeps the threads an account started as a guest after it became a host", async () => {
      const asHost = await service.start(GUEST_ID, about(LISTING_ID));
      // The owner of one listing writing about another — a guest promoted since.
      const asGuest = await service.start(OWNER_ID, about(OTHER_LISTING_ID));

      const page = await service.findPage(owner, threadsFor());

      expect(page.items.map((thread) => [thread.id, thread.side])).toEqual([
        [asGuest.id, ConversationSide.GUEST],
        [asHost.id, ConversationSide.HOST],
      ]);
    });

    it("narrows the scope by listing and never widens it", async () => {
      await service.start(OTHER_GUEST_ID, about(OTHER_LISTING_ID));

      const page = await service.findPage(
        guest,
        threadsFor({ listingId: OTHER_LISTING_ID }),
      );

      expect(page.items).toEqual([]);
    });

    it("pages with a cursor of its own and refuses one it did not write", async () => {
      await service.start(GUEST_ID, about(LISTING_ID));
      await service.start(GUEST_ID, about(OTHER_LISTING_ID));

      const first = await service.findPage(guest, threadsFor({ limit: "1" }));

      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();

      const second = await service.findPage(
        guest,
        threadsFor({ limit: "1", cursor: first.nextCursor ?? "" }),
      );

      expect(second.items).toHaveLength(1);
      expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
      expect(second.nextCursor).toBeNull();

      await expect(
        service.findPage(guest, threadsFor({ cursor: "not-a-cursor" })),
      ).rejects.toThrow(BadRequestException);
    });

    it("refuses an admin rather than handing them a scope", async () => {
      await expect(service.findPage(admin, threadsFor())).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("the two sides", () => {
    it("lets either side write, and makes it news to the other only", async () => {
      const started = await service.start(GUEST_ID, about(LISTING_ID));
      const { id } = started;

      await service.markRead(id, owner, {
        upTo: started.lastMessage.createdAt,
      });
      await expect(service.findOne(id, owner)).resolves.toMatchObject({
        unread: false,
      });

      const reply = await service.send(id, owner, { body: "Welcome" });

      expect(reply.sender).toBe(ConversationSide.HOST);
      await expect(service.findOne(id, owner)).resolves.toMatchObject({
        unread: false,
      });
      await expect(service.findOne(id, guest)).resolves.toMatchObject({
        unread: true,
        lastMessage: { sender: ConversationSide.HOST, body: "Welcome" },
      });
    });

    it("marks read only up to the message the screen showed", async () => {
      const started = await service.start(GUEST_ID, about(LISTING_ID, "One"));
      const { id } = started;

      // Written after the host's screen was drawn, before it reported back.
      const later = await service.send(id, guest, { body: "Two" });

      await service.markRead(id, owner, {
        upTo: started.lastMessage.createdAt,
      });
      await expect(service.findOne(id, owner)).resolves.toMatchObject({
        unread: true,
      });

      // A moment past the newest message names nothing a screen could have shown.
      await service.markRead(id, owner, { upTo: "2099-01-01T00:00:00.000Z" });
      await expect(service.findOne(id, owner)).resolves.toMatchObject({
        unread: true,
      });

      await service.markRead(id, owner, { upTo: later.createdAt });
      await expect(service.findOne(id, owner)).resolves.toMatchObject({
        unread: false,
      });
    });

    it("reads the thread from its end, a page at a time", async () => {
      const { id } = await service.start(GUEST_ID, about(LISTING_ID, "First"));

      await service.send(id, owner, { body: "Second" });
      await service.send(id, guest, { body: "Third" });

      const first = await service.findMessages(
        id,
        guest,
        messagesFor({ limit: "2" }),
      );

      expect(first.items.map((message) => message.body)).toEqual([
        "Third",
        "Second",
      ]);

      const rest = await service.findMessages(
        id,
        owner,
        messagesFor({ limit: "2", cursor: first.nextCursor ?? "" }),
      );

      expect(rest.items.map((message) => message.body)).toEqual(["First"]);
      expect(rest.nextCursor).toBeNull();
    });

    it("answers anybody who is neither side with a 404", async () => {
      const { id } = await service.start(GUEST_ID, about(LISTING_ID));

      for (const outsider of [stranger, otherOwner, admin]) {
        await expect(service.findOne(id, outsider)).rejects.toThrow(
          NotFoundException,
        );
        await expect(
          service.findMessages(id, outsider, messagesFor()),
        ).rejects.toThrow(NotFoundException);
        await expect(
          service.send(id, outsider, { body: "Hi" }),
        ).rejects.toThrow(NotFoundException);
        await expect(
          service.markRead(id, outsider, {
            upTo: "2026-08-17T12:00:01.000Z",
          }),
        ).rejects.toThrow(NotFoundException);
      }

      expect(
        conversationRepository.messages.map((message) => message.body),
      ).toEqual(["Hello"]);
    });

    it("answers a thread that does not exist the same way", async () => {
      await expect(service.findOne(randomUUID(), guest)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("the event stream", () => {
    it("pushes a new thread's first message to both sides, each with its own counts", async () => {
      await service.start(GUEST_ID, about(LISTING_ID));

      expect(realtimeService.published).toEqual([
        {
          userId: GUEST_ID,
          event: expect.objectContaining({
            type: "message.created",
            unreadConversations: 0,
          }) as ServerEvent,
        },
        {
          userId: OWNER_ID,
          event: expect.objectContaining({
            type: "message.created",
            message: expect.objectContaining({
              sender: ConversationSide.GUEST,
              body: "Hello",
            }) as Message,
            unreadConversations: 1,
          }) as ServerEvent,
        },
      ]);
    });

    it("counts the thread read for its sender once they reply", async () => {
      const { id } = await service.start(GUEST_ID, about(LISTING_ID));

      realtimeService.published.length = 0;
      await service.send(id, owner, { body: "Welcome" });

      const counts = Object.fromEntries(
        realtimeService.published.map(({ userId, event }) => [
          userId,
          event.unreadConversations,
        ]),
      );

      expect(counts).toEqual({ [GUEST_ID]: 1, [OWNER_ID]: 0 });
    });

    it("tells the reader's tabs about a read, and nobody about one that moved nothing", async () => {
      const started = await service.start(GUEST_ID, about(LISTING_ID));
      const upTo = started.lastMessage.createdAt;

      realtimeService.published.length = 0;
      await service.markRead(started.id, owner, { upTo });

      expect(realtimeService.published).toEqual([
        {
          userId: OWNER_ID,
          event: {
            type: "conversation.read",
            conversationId: started.id,
            unreadNotifications: 0,
            unreadConversations: 0,
            unreadRevision: expect.any(Number) as number,
          },
        },
      ]);

      await service.markRead(started.id, owner, { upTo });

      expect(realtimeService.published).toHaveLength(1);
    });
  });
});
