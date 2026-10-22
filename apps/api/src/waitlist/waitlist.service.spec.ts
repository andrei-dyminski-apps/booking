import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import {
  NotificationType,
  Role,
  type JoinWaitlistInput,
  type NotificationContent,
  type WaitlistDemandEntry,
  type WaitlistDemandQuery,
  type WaitlistEntry,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { Page } from "../common/paging";
import { NotificationService } from "../notification/notification.service";
import {
  NightsAvailableError,
  WaiterHoldsNightsError,
  WaiterNotFoundError,
  WaitlistFullError,
  WaitlistListingNotFoundError,
  WaitlistOwnListingError,
  WaitlistRepository,
} from "./waitlist.repository";
import { WaitlistService } from "./waitlist.service";
import type { FreedNights, WaitingEntry } from "./waitlist.types";

const WAITER_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OTHER_WAITER_ID = "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50";
const LISTING_ID = "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
const OTHER_LISTING_ID = "3a4b5c6d-7e8f-4a91-8b2c-3d4e5f6a7b8c";
const OWNER_ID = "4b5c6d7e-8f9a-4b02-9c3d-4e5f6a7b8c9d";

const owner: AuthenticatedUser = {
  id: OWNER_ID,
  email: "owner@example.com",
  role: Role.USER,
};
const admin: AuthenticatedUser = {
  id: "5c6d7e8f-9a0b-4c13-8d4e-5f6a7b8c9d0e",
  email: "admin@example.com",
  role: Role.ADMIN,
};

const firstPage = (limit = 20): WaitlistDemandQuery => ({
  sort: "checkInAsc",
  limit,
});

const input: JoinWaitlistInput = {
  listingId: LISTING_ID,
  from: "2026-09-01",
  to: "2026-09-05",
};

const freed: FreedNights = input;

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

/**
 * The repository's rules — the locks, the cap, whether nights are held — are the e2e
 * spec's. What this fake keeps is the shape the service reasons about: a refusal to
 * translate, the entries a release finds free, and a claim only the first caller wins.
 */
class FakeWaitlistRepository implements PublicOf<WaitlistRepository> {
  readonly entries = new Map<string, WaitlistEntry & { userId: string }>();

  /** Whose each listing is — only `LISTING_ID` is the owner's. */
  readonly owners = new Map([
    [LISTING_ID, OWNER_ID],
    [OTHER_LISTING_ID, OTHER_WAITER_ID],
  ]);

  /** What `join` refuses with, when a spec wants a refusal. */
  refusal: Error | null = null;

  /** Set to have the read behind a release fail, as a dropped connection would. */
  failing = false;

  /**
   * Whether somebody still holds every range waited for — what the read after a join
   * finds, and what a spec clears to have a release find the nights free.
   */
  held = true;

  join(userId: string, joined: JoinWaitlistInput): Promise<WaitlistEntry> {
    if (this.refusal !== null) return Promise.reject(this.refusal);

    const entry = {
      ...joined,
      id: randomUUID(),
      userId,
      listing: { title: "Loft above the harbour", pricePerNight: 120 },
      createdAt: new Date().toISOString(),
    };

    this.entries.set(entry.id, entry);

    return Promise.resolve(entry);
  }

  findFor(userId: string): Promise<WaitlistEntry[]> {
    return Promise.resolve(
      [...this.entries.values()].filter((entry) => entry.userId === userId),
    );
  }

  findPageForEveryone(
    query: WaitlistDemandQuery,
  ): Promise<Page<WaitlistDemandEntry>> {
    return Promise.resolve(
      this.page(
        [...this.entries.values()].map((entry) =>
          toDemand(entry, { id: entry.userId, name: "Maya Lindqvist" }),
        ),
        query,
      ),
    );
  }

  findPageForListingOwner(
    ownerId: string,
    query: WaitlistDemandQuery,
  ): Promise<Page<WaitlistDemandEntry>> {
    return Promise.resolve(
      this.page(
        [...this.entries.values()]
          .filter((entry) => this.owners.get(entry.listingId) === ownerId)
          .map((entry) => toDemand(entry, null)),
        query,
      ),
    );
  }

  leave(userId: string, id: string): Promise<boolean> {
    if (this.entries.get(id)?.userId !== userId) return Promise.resolve(false);

    return Promise.resolve(this.entries.delete(id));
  }

  findNowFree(nights: FreedNights): Promise<WaitingEntry[]> {
    if (this.failing) return Promise.reject(new Error("connection lost"));

    if (this.held) return Promise.resolve([]);

    return Promise.resolve(
      [...this.entries.values()]
        .filter(
          (entry) =>
            entry.listingId === nights.listingId &&
            entry.from < nights.to &&
            entry.to > nights.from,
        )
        .map((entry) => ({
          id: entry.id,
          userId: entry.userId,
          nights: {
            listingId: entry.listingId,
            listingTitle: entry.listing.title,
            from: entry.from,
            to: entry.to,
          },
        })),
    );
  }

  claim(ids: string[]): Promise<Set<string>> {
    return Promise.resolve(
      new Set(ids.filter((id) => this.entries.delete(id))),
    );
  }

  private page(
    rows: WaitlistDemandEntry[],
    query: WaitlistDemandQuery,
  ): Page<WaitlistDemandEntry> {
    return {
      items: rows.slice(0, query.limit),
      hasMore: rows.length > query.limit,
    };
  }
}

function toDemand(
  entry: WaitlistEntry,
  waiter: WaitlistDemandEntry["waiter"],
): WaitlistDemandEntry {
  const { id, listingId, listing, from, to, createdAt } = entry;

  return { id, listingId, listing, from, to, createdAt, waiter };
}

class FakeNotificationService implements Pick<NotificationService, "notify"> {
  readonly notices: { userId: string; content: NotificationContent }[] = [];

  notify(userId: string, content: NotificationContent): Promise<void> {
    this.notices.push({ userId, content });

    return Promise.resolve();
  }
}

describe("WaitlistService", () => {
  let service: WaitlistService;
  let waitlistRepository: FakeWaitlistRepository;
  let notificationService: FakeNotificationService;

  beforeEach(async () => {
    waitlistRepository = new FakeWaitlistRepository();
    notificationService = new FakeNotificationService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        WaitlistService,
        { provide: WaitlistRepository, useValue: waitlistRepository },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = moduleRef.get(WaitlistService);
  });

  it("answers each refusal of the repository the way a booking's is answered", async () => {
    const cases: [Error, new (...args: never[]) => Error][] = [
      [new WaitlistListingNotFoundError(LISTING_ID), NotFoundException],
      [new WaitlistOwnListingError(LISTING_ID), ForbiddenException],
      [new WaiterNotFoundError(WAITER_ID), UnauthorizedException],
      [new NightsAvailableError(input), ConflictException],
      [new WaitlistFullError(), ForbiddenException],
      [new WaiterHoldsNightsError(input), ForbiddenException],
    ];

    for (const [refusal, answer] of cases) {
      waitlistRepository.refusal = refusal;

      await expect(service.join(WAITER_ID, input)).rejects.toThrow(answer);
    }
  });

  it("lets a waiter leave their own entry, and answers 404 for anybody else's", async () => {
    const entry = await service.join(WAITER_ID, input);

    await expect(service.leave(OTHER_WAITER_ID, entry.id)).rejects.toThrow(
      NotFoundException,
    );
    await service.leave(WAITER_ID, entry.id);
    await expect(service.findMine(WAITER_ID)).resolves.toEqual([]);
  });

  it("tells everybody waiting for the freed nights, and takes them off the list", async () => {
    await service.join(WAITER_ID, input);
    await service.join(OTHER_WAITER_ID, input);
    waitlistRepository.held = false;

    await service.announceFreed([freed]);

    expect(notificationService.notices).toEqual(
      [WAITER_ID, OTHER_WAITER_ID].map((userId) => ({
        userId,
        content: {
          type: NotificationType.WAITLIST_AVAILABLE,
          data: {
            listingId: LISTING_ID,
            listingTitle: "Loft above the harbour",
            from: input.from,
            to: input.to,
          },
        },
      })),
    );
    await expect(service.findMine(WAITER_ID)).resolves.toEqual([]);
  });

  it("tells nobody twice when two releases reach the same entry", async () => {
    await service.join(WAITER_ID, input);
    waitlistRepository.held = false;

    await Promise.all([
      service.announceFreed([freed]),
      service.announceFreed([freed]),
    ]);

    expect(notificationService.notices).toHaveLength(1);
  });

  it("tells a waiter at once when the nights came free while they joined", async () => {
    waitlistRepository.held = false;

    await service.join(WAITER_ID, input);

    expect(notificationService.notices).toMatchObject([
      {
        userId: WAITER_ID,
        content: { type: NotificationType.WAITLIST_AVAILABLE },
      },
    ]);
    await expect(service.findMine(WAITER_ID)).resolves.toEqual([]);
  });

  it("never fails the release that called it", async () => {
    await service.join(WAITER_ID, input);
    waitlistRepository.held = false;
    waitlistRepository.failing = true;

    await expect(service.announceFreed([freed])).resolves.toBeUndefined();
    expect(notificationService.notices).toEqual([]);
  });

  it("shows a host the ranges waited for on their own listings, and not who waits", async () => {
    await service.join(WAITER_ID, input);
    await service.join(WAITER_ID, { ...input, listingId: OTHER_LISTING_ID });

    const page = await service.findDemand(owner, firstPage());

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      listingId: LISTING_ID,
      waiter: null,
    });
  });

  it("shows an admin every range, with who waits", async () => {
    await service.join(WAITER_ID, input);
    await service.join(OTHER_WAITER_ID, {
      ...input,
      listingId: OTHER_LISTING_ID,
    });

    const page = await service.findDemand(admin, firstPage());

    expect(page.items.map((entry) => entry.waiter?.id)).toEqual([
      WAITER_ID,
      OTHER_WAITER_ID,
    ]);
  });

  it("issues a cursor only while there is another page", async () => {
    await service.join(WAITER_ID, input);
    await service.join(OTHER_WAITER_ID, input);

    const first = await service.findDemand(admin, firstPage(1));
    const whole = await service.findDemand(admin, firstPage(2));

    expect(first.nextCursor).not.toBeNull();
    expect(whole.nextCursor).toBeNull();
  });

  it("refuses a cursor it did not issue", async () => {
    await expect(
      service.findDemand(owner, { ...firstPage(), cursor: "not-a-cursor" }),
    ).rejects.toThrow(BadRequestException);
  });
});
