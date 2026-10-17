import { Test } from "@nestjs/testing";
import { UnreadRepository } from "./unread.repository";
import { UnreadService } from "./unread.service";
import type { UnreadCounts } from "./unread.types";

const ALICE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

/** Every account's counts in memory, as the last write under the lock left them. */
class FakeUnreadRepository implements PublicOf<UnreadRepository> {
  readonly counts = new Map<string, UnreadCounts>();

  count(userId: string): Promise<UnreadCounts> {
    return Promise.resolve(
      this.counts.get(userId) ?? {
        notifications: 0,
        conversations: 0,
        revision: 0,
      },
    );
  }
}

describe("UnreadService", () => {
  let service: UnreadService;
  let unreadRepository: FakeUnreadRepository;

  beforeEach(async () => {
    unreadRepository = new FakeUnreadRepository();

    const moduleRef = await Test.createTestingModule({
      providers: [
        UnreadService,
        { provide: UnreadRepository, useValue: unreadRepository },
      ],
    }).compile();

    service = moduleRef.get(UnreadService);
  });

  it("answers both halves of the count with the revision they were counted at", async () => {
    unreadRepository.counts.set(ALICE, {
      notifications: 2,
      conversations: 3,
      revision: 7,
    });

    await expect(service.count(ALICE)).resolves.toEqual({
      notifications: 2,
      conversations: 3,
      revision: 7,
    });
  });
});
