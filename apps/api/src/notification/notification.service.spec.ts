import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import {
  notificationQuerySchema,
  NotificationType,
  type Notification,
  type NotificationContent,
  type NotificationQuery,
  type ServerEvent,
} from "@repo/contracts";
import type { Page } from "../common/paging";
import { RealtimeService } from "../realtime/realtime.service";
import type { UnreadCounts } from "../unread/unread.types";
import type { NotificationCursor } from "./notification-cursor";
import { NotificationRepository } from "./notification.repository";
import { NotificationService } from "./notification.service";

const ALICE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const BOB = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

const requested = (title = "Loft above the harbour"): NotificationContent => ({
  type: NotificationType.BOOKING_REQUESTED,
  data: {
    bookingId: randomUUID(),
    listingId: randomUUID(),
    listingTitle: title,
    from: "2026-09-01",
    to: "2026-09-05",
  },
});

const searchFor = (search: Record<string, string> = {}): NotificationQuery =>
  notificationQuerySchema.parse(search);

/**
 * The feed in memory, newest first. What it has to get right is the shape the service
 * reasons about — rows scoped to their recipient, a page of `limit` with `hasMore`, a write
 * by id that matches nothing outside the recipient's own rows — not the SQL, which is the
 * e2e spec's half.
 */
class FakeNotificationRepository implements PublicOf<NotificationRepository> {
  readonly rows: { userId: string; notification: Notification }[] = [];

  /** Set to have every write fail, as a database that went away would. */
  broken = false;

  /** The accounts `findAdminIds` answers: the admins who are not blocked. */
  admins: string[] = [];

  findAdminIds(): Promise<string[]> {
    if (this.broken) return Promise.reject(new Error("connection refused"));

    return Promise.resolve([...this.admins]);
  }

  /** The fake's clock: every count is one tick later than the last, as under the real lock. */
  private revision = 0;

  create(
    userId: string,
    content: NotificationContent,
  ): Promise<{ notification: Notification; count: UnreadCounts }> {
    if (this.broken) return Promise.reject(new Error("connection refused"));

    const notification: Notification = {
      ...content,
      id: randomUUID(),
      readAt: null,
      // Distinct moments, so the ordering never falls back on the random id alone.
      createdAt: new Date(
        Date.parse("2026-10-11T08:00:00.000Z") + this.rows.length * 1_000,
      ).toISOString(),
    };

    this.rows.push({ userId, notification });

    return Promise.resolve({ notification, count: this.countOf(userId) });
  }

  findPage(
    userId: string,
    query: NotificationQuery,
    cursor: NotificationCursor | null,
  ): Promise<Page<Notification>> {
    const feed = this.ownedBy(userId).reverse();
    const start =
      cursor === null ? 0 : feed.findIndex((row) => row.id === cursor.id) + 1;

    return Promise.resolve({
      items: feed.slice(start, start + query.limit),
      hasMore: feed.length > start + query.limit,
    });
  }

  countUnread(userId: string): Promise<UnreadCounts> {
    return Promise.resolve(this.countOf(userId));
  }

  markRead(
    userId: string,
    id: string,
  ): Promise<{ changed: boolean; count: UnreadCounts } | null> {
    const row = this.ownedBy(userId).find((row) => row.id === id);

    if (row === undefined) return Promise.resolve(null);

    const changed = row.readAt === null;

    row.readAt ??= new Date().toISOString();

    return Promise.resolve({ changed, count: this.countOf(userId) });
  }

  markAllRead(
    userId: string,
  ): Promise<{ changed: number; count: UnreadCounts }> {
    const unread = this.ownedBy(userId).filter((row) => row.readAt === null);

    for (const row of unread) row.readAt = new Date().toISOString();

    return Promise.resolve({
      changed: unread.length,
      count: this.countOf(userId),
    });
  }

  /** No threads here: what they add to the counts is `ConversationService`'s to test. */
  private countOf(userId: string): UnreadCounts {
    this.revision += 1;

    return {
      notifications: this.ownedBy(userId).filter((row) => row.readAt === null)
        .length,
      conversations: 0,
      revision: this.revision,
    };
  }

  private ownedBy(userId: string): Notification[] {
    return this.rows
      .filter((row) => row.userId === userId)
      .map((row) => row.notification);
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

const refundFailed: NotificationContent = {
  type: NotificationType.REFUND_FAILED,
  data: {
    refundId: "re_1",
    paymentId: "pi_1",
    bookingId: null,
    amount: 100,
    reason: "expired_or_canceled_card",
  },
};

describe("NotificationService", () => {
  let service: NotificationService;
  let notificationRepository: FakeNotificationRepository;
  let realtimeService: FakeRealtimeService;

  beforeEach(async () => {
    notificationRepository = new FakeNotificationRepository();
    realtimeService = new FakeRealtimeService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: NotificationRepository, useValue: notificationRepository },
        { provide: RealtimeService, useValue: realtimeService },
      ],
    }).compile();

    service = moduleRef.get(NotificationService);
  });

  it("stores the notice, then pushes it to its recipient with the unread count", async () => {
    await service.notify(ALICE, requested());
    await service.notify(ALICE, requested());

    const [, second] = realtimeService.published;

    expect(realtimeService.published).toHaveLength(2);
    expect(second).toEqual({
      userId: ALICE,
      event: {
        type: "notification.created",
        notification: expect.objectContaining({
          type: NotificationType.BOOKING_REQUESTED,
          readAt: null,
        }) as Notification,
        unreadNotifications: 2,
        unreadConversations: 0,
        unreadRevision: expect.any(Number) as number,
      },
    });
  });

  it("tells every admin the same news, each with a row and an event of their own", async () => {
    notificationRepository.admins = [ALICE, BOB];

    await service.notifyAdmins(refundFailed);

    expect(notificationRepository.rows.map(({ userId }) => userId)).toEqual([
      ALICE,
      BOB,
    ]);
    expect(realtimeService.published.map(({ userId }) => userId)).toEqual([
      ALICE,
      BOB,
    ]);
  });

  it("tells nobody, and does not throw, when the admins cannot be read", async () => {
    notificationRepository.admins = [ALICE];
    notificationRepository.broken = true;

    await expect(service.notifyAdmins(refundFailed)).resolves.toBeUndefined();
    expect(realtimeService.published).toEqual([]);
  });

  // The write it announces is already committed by the caller: a failure here must cost the
  // notice and nothing else.
  it("swallows a failure to store, and pushes nothing it did not store", async () => {
    notificationRepository.broken = true;

    await expect(service.notify(ALICE, requested())).resolves.toBeUndefined();
    expect(realtimeService.published).toEqual([]);
  });

  it("pages the recipient's own feed, newest first", async () => {
    for (const title of ["first", "second", "third"]) {
      await service.notify(ALICE, requested(title));
    }
    await service.notify(BOB, requested("not Alice's"));

    const first = await service.findPage(ALICE, searchFor({ limit: "2" }));
    const titles = (page: Notification[]): string[] =>
      page.map((notification) =>
        "listingTitle" in notification.data
          ? notification.data.listingTitle
          : "",
      );

    expect(titles(first.items)).toEqual(["third", "second"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.findPage(
      ALICE,
      searchFor({ limit: "2", cursor: String(first.nextCursor) }),
    );

    expect(titles(second.items)).toEqual(["first"]);
    expect(second.nextCursor).toBeNull();
  });

  it("refuses a cursor it did not issue", async () => {
    await expect(
      service.findPage(ALICE, searchFor({ cursor: "not-a-cursor" })),
    ).rejects.toThrow(BadRequestException);
  });

  it("marks one read, tells every tab of the account, and answers what is left", async () => {
    await service.notify(ALICE, requested());
    await service.notify(ALICE, requested());

    const [first] = (await service.findPage(ALICE, searchFor())).items;

    const left = await service.markRead(ALICE, String(first?.id));

    expect(left.unread).toBe(1);
    expect(realtimeService.published.at(-1)).toEqual({
      userId: ALICE,
      event: {
        type: "notifications.read",
        unreadNotifications: 1,
        unreadConversations: 0,
        unreadRevision: left.revision,
      },
    });
  });

  it("reads a notice twice without complaint", async () => {
    await service.notify(ALICE, requested());

    const [only] = (await service.findPage(ALICE, searchFor())).items;
    const id = String(only?.id);

    await service.markRead(ALICE, id);

    const published = realtimeService.published.length;

    await expect(service.markRead(ALICE, id)).resolves.toMatchObject({
      unread: 0,
    });
    // Nothing changed, so no tab is told to refresh over it.
    expect(realtimeService.published).toHaveLength(published);
  });

  it("announces a mark-all only when there was something to mark", async () => {
    await expect(service.markAllRead(ALICE)).resolves.toMatchObject({
      unread: 0,
    });
    expect(realtimeService.published).toEqual([]);
  });

  it("orders every count of an account by a revision that only grows", async () => {
    await service.notify(ALICE, requested());

    const before = await service.unreadCount(ALICE);
    const after = await service.markAllRead(ALICE);

    expect(after.revision).toBeGreaterThan(before.revision);
  });

  it("answers 404 for somebody else's notice, and leaves it unread", async () => {
    await service.notify(BOB, requested());

    const [bobs] = (await service.findPage(BOB, searchFor())).items;

    await expect(service.markRead(ALICE, String(bobs?.id))).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.unreadCount(BOB)).resolves.toMatchObject({
      unread: 1,
    });
  });

  it("marks all of one account's notices read and no one else's", async () => {
    await service.notify(ALICE, requested());
    await service.notify(ALICE, requested());
    await service.notify(BOB, requested());

    await expect(service.markAllRead(ALICE)).resolves.toMatchObject({
      unread: 0,
    });
    await expect(service.unreadCount(BOB)).resolves.toMatchObject({
      unread: 1,
    });
  });
});
