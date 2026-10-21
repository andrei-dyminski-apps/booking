import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  Role,
  type ManagedUser,
  type ManagedUserDetail,
  type UpdateUserInput,
  type User,
  type UserQuery,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { Page } from "../common/paging";
import { decodeCursor, type UserCursor } from "./user-cursor";
import {
  CallerNotAdminError,
  UserRepository,
  type UserCredentials,
} from "./user.repository";
import { UserService } from "./user.service";

const ADMIN_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const UNKNOWN_ID = "0b6f7f6e-2f4c-4a52-9a5e-8f1f6d2c3b4a";

const admin: AuthenticatedUser = {
  id: ADMIN_ID,
  email: "admin@example.com",
  role: Role.ADMIN,
};

/** The whole of a query, so a test names only the part it is about. */
const query = (over: Partial<UserQuery> = {}): UserQuery => ({
  limit: 20,
  sort: "newest",
  ...over,
});

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
type PublicOf<T> = { [K in keyof T]: T[K] };

/**
 * The role check of the token is `RolesGuard`'s, so what is left here is which account a
 * change lands on, whether the caller's own row still backs the token, and what the page
 * looks like — asserted on what ends up stored rather than on the
 * calls the service makes. The SQL, the session deletion and the filters are the e2e
 * spec's half.
 */
class FakeUserRepository implements PublicOf<UserRepository> {
  readonly rows: ManagedUser[] = [];

  add(over: Partial<ManagedUser> = {}): ManagedUser {
    const index = this.rows.length;
    const row: ManagedUser = {
      id: crypto.randomUUID(),
      name: `User ${index}`,
      email: `user${index}@example.com`,
      role: Role.USER,
      // One second apart and in insertion order, so `newest` is the reverse of it.
      createdAt: new Date(Date.UTC(2026, 7, 20, 12, 0, index)).toISOString(),
      blockedAt: null,
      ...over,
    };

    this.rows.push(row);

    return row;
  }

  // AuthService's half of the repository. Nothing here calls it.
  create(): Promise<User> {
    return Promise.reject(new Error("UserService does not register users"));
  }

  findByEmail(): Promise<UserCredentials | null> {
    return Promise.reject(new Error("UserService does not sign anybody in"));
  }

  // AuthService's read of a session. Nothing here calls it.
  findActiveById(id: string): Promise<User | null> {
    const row = this.rows.find(
      (candidate) => candidate.id === id && candidate.blockedAt === null,
    );

    if (row === undefined) return Promise.resolve(null);

    return Promise.resolve({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      createdAt: row.createdAt,
    });
  }

  /** The counts are subqueries the e2e spec covers; here every account has nothing yet. */
  findDetailById(id: string): Promise<ManagedUserDetail | null> {
    const row = this.rows.find((candidate) => candidate.id === id);

    if (row === undefined) return Promise.resolve(null);

    return Promise.resolve({ ...row, bookingCount: 0, listingCount: 0 });
  }

  findPage(
    pageQuery: UserQuery,
    cursor: UserCursor | null,
  ): Promise<Page<ManagedUser>> {
    const ordered = [...this.rows].sort((a, b) =>
      pageQuery.sort === "newest"
        ? b.createdAt.localeCompare(a.createdAt)
        : a.createdAt.localeCompare(b.createdAt),
    );
    const start =
      cursor === null
        ? 0
        : ordered.findIndex((row) => row.id === cursor.id) + 1;
    const rest = ordered.slice(start);

    return Promise.resolve({
      items: rest.slice(0, pageQuery.limit),
      hasMore: rest.length > pageQuery.limit,
    });
  }

  /** The caller's own row is read before the write, as the lock does in the real one. */
  update(
    callerId: string,
    id: string,
    change: UpdateUserInput,
  ): Promise<ManagedUser | null> {
    const caller = this.rows.find((candidate) => candidate.id === callerId);

    if (caller?.role !== Role.ADMIN || caller.blockedAt !== null) {
      return Promise.reject(new CallerNotAdminError(callerId));
    }

    const row = this.rows.find((candidate) => candidate.id === id);

    if (row === undefined) return Promise.resolve(null);

    if (change.role !== undefined) row.role = change.role;
    if (change.blocked === true) {
      row.blockedAt ??= new Date().toISOString();
    }
    if (change.blocked === false) row.blockedAt = null;

    return Promise.resolve({ ...row });
  }
}

describe("UserService", () => {
  let service: UserService;
  let userRepository: FakeUserRepository;

  beforeEach(async () => {
    userRepository = new FakeUserRepository();

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: UserRepository, useValue: userRepository },
      ],
    }).compile();

    service = moduleRef.get(UserService);
  });

  /** The row behind `admin`'s token, which every change reads before it writes. */
  const addCaller = (over: Partial<ManagedUser> = {}): ManagedUser =>
    userRepository.add({ id: ADMIN_ID, role: Role.ADMIN, ...over });

  it("changes the role of another account", async () => {
    addCaller();
    const guest = userRepository.add();

    const updated = await service.update(admin, guest.id, {
      role: Role.ADMIN,
    });

    expect(updated.role).toBe(Role.ADMIN);
    expect(userRepository.rows[1]?.role).toBe(Role.ADMIN);
  });

  it("blocks and unblocks another account", async () => {
    addCaller();
    const guest = userRepository.add();

    const blocked = await service.update(admin, guest.id, { blocked: true });

    expect(blocked.blockedAt).not.toBeNull();

    const reopened = await service.update(admin, guest.id, { blocked: false });

    expect(reopened.blockedAt).toBeNull();
  });

  it("refuses to change the caller's own account, whatever the change", async () => {
    const self = addCaller();

    for (const change of [
      { role: Role.USER },
      { blocked: true },
      { role: Role.ADMIN, blocked: false },
    ] satisfies UpdateUserInput[]) {
      await expect(service.update(admin, self.id, change)).rejects.toThrow(
        ForbiddenException,
      );
    }

    // Refused before anything was written, not undone afterwards.
    expect(userRepository.rows[0]).toEqual(self);
  });

  it("refuses the caller's own account spelled in upper case", async () => {
    // `ParseUUIDPipe` lets it through, and Postgres finds the same row by it.
    const self = addCaller();

    await expect(
      service.update(admin, self.id.toUpperCase(), { role: Role.USER }),
    ).rejects.toThrow(ForbiddenException);
    expect(userRepository.rows[0]).toEqual(self);
  });

  it("refuses a token whose account has been blocked or demoted since it was issued", async () => {
    for (const caller of [
      { blockedAt: new Date().toISOString() },
      { role: Role.USER },
    ] satisfies Partial<ManagedUser>[]) {
      userRepository.rows.length = 0;
      addCaller(caller);
      const victim = userRepository.add({ role: Role.ADMIN });

      await expect(
        service.update(admin, victim.id, { blocked: true }),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.rows[1]).toEqual(victim);
    }
  });

  it("lets one admin change another — the second pair of eyes is the point", async () => {
    addCaller();
    const otherAdmin = userRepository.add({ role: Role.ADMIN });

    await expect(
      service.update(admin, otherAdmin.id, { role: Role.USER }),
    ).resolves.toMatchObject({ role: Role.USER });
  });

  it("answers 404 for an account that does not exist", async () => {
    addCaller();

    await expect(
      service.update(admin, UNKNOWN_ID, { blocked: true }),
    ).rejects.toThrow(NotFoundException);
  });

  it("reads one account, blocked or not, the caller's own included", async () => {
    const self = addCaller();
    const blocked = userRepository.add({
      blockedAt: new Date().toISOString(),
    });

    await expect(service.findOne(self.id)).resolves.toMatchObject({
      id: self.id,
    });
    await expect(service.findOne(blocked.id)).resolves.toMatchObject({
      blockedAt: blocked.blockedAt,
    });
  });

  it("answers 404 when reading an account that does not exist", async () => {
    await expect(service.findOne(UNKNOWN_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("issues a cursor while there is another page, and none on the last one", async () => {
    for (let index = 0; index < 3; index += 1) userRepository.add();

    const first = await service.findPage(query({ limit: 2 }));

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.findPage(
      query({ limit: 2, cursor: first.nextCursor ?? undefined }),
    );

    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((row) => row.id)).toEqual(
      [...userRepository.rows].reverse().map((row) => row.id),
    );
  });

  it("issues a cursor made of the last row and the ordering it was asked under", async () => {
    for (let index = 0; index < 2; index += 1) userRepository.add();

    const page = await service.findPage(query({ limit: 1, sort: "oldest" }));
    const [first] = page.items;

    expect(decodeCursor(page.nextCursor ?? "")).toEqual({
      sort: "oldest",
      createdAt: new Date(first?.createdAt ?? ""),
      id: first?.id,
    });
  });

  it("refuses a cursor it did not issue, and one issued under the other ordering", async () => {
    for (let index = 0; index < 2; index += 1) userRepository.add();

    await expect(
      service.findPage(query({ cursor: "not-a-cursor" })),
    ).rejects.toThrow(BadRequestException);

    const newest = await service.findPage(query({ limit: 1 }));

    await expect(
      service.findPage(
        query({ sort: "oldest", cursor: newest.nextCursor ?? undefined }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
