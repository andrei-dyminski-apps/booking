import { randomUUID } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import type { ManagedUser, User } from "@repo/contracts";
import type { Page } from "../common/paging";
import * as argon2 from "argon2";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config";
import { AuthService } from "./auth.service";
import type { IssuedRefreshToken } from "./auth.types";
import {
  RefreshTokenRepository,
  type StoredRefreshToken,
} from "./refresh-token.repository";
import { TokenService } from "./token.service";
import {
  EmailAlreadyRegisteredError,
  UserRepository,
  type UserCredentials,
} from "../user/user.repository";

const config: AuthConfig = {
  accessSecret: "access-secret",
  refreshSecret: "refresh-secret",
  accessTtl: 900,
  refreshTtl: 604800,
  cookie: { httpOnly: true, secure: false, sameSite: "lax" },
};

const credentials = { email: "guest@example.com", password: "password123" };

/**
 * A homomorphic mapped type keeps only the public surface of a class — private members are
 * not part of `keyof`. So a fake can stand in for a repository without extending it, and
 * still stops compiling the moment the real one gains or drops a method, or changes what
 * one returns.
 *
 * What it does not catch is a parameter added to an existing method, or one whose type is
 * widened: a shorter signature stays assignable to a longer one, and method parameters are
 * compared bivariantly even under `strictFunctionTypes`. A changed argument list therefore
 * has to be carried into the fakes by hand.
 */
type PublicOf<T> = { [K in keyof T]: T[K] };

/**
 * The repositories are faked rather than mocked: the rotation rules are about what ends up
 * stored after a sequence of calls, and a mock that records arguments can only assert the
 * calls the service happens to make today.
 */
class FakeUserRepository implements PublicOf<UserRepository> {
  readonly rows = new Map<string, UserCredentials>();

  create(input: { email: string; passwordHash: string }): Promise<User> {
    if (this.rowByEmail(input.email) !== undefined) {
      return Promise.reject(new EmailAlreadyRegisteredError(input.email));
    }

    const user: User = {
      id: randomUUID(),
      email: input.email,
      role: "USER",
      createdAt: new Date("2026-08-19T12:00:00.000Z").toISOString(),
    };

    this.rows.set(user.id, {
      user,
      passwordHash: input.passwordHash,
      blocked: false,
    });

    return Promise.resolve(user);
  }

  findByEmail(email: string): Promise<UserCredentials | null> {
    return Promise.resolve(this.rowByEmail(email) ?? null);
  }

  findActiveById(id: string): Promise<User | null> {
    const row = this.rows.get(id);

    return Promise.resolve(row === undefined || row.blocked ? null : row.user);
  }

  // The admin's half of the repository. AuthService never calls it, and a fake that
  // answered anyway would be a second implementation of rules `UserService` owns.
  findPage(): Promise<Page<ManagedUser>> {
    return Promise.reject(new Error("AuthService does not page users"));
  }

  update(): Promise<ManagedUser | null> {
    return Promise.reject(new Error("AuthService does not update users"));
  }

  /** What blocking does to the row; the tokens it deletes are the other fake's business. */
  block(id: string): void {
    const row = this.rows.get(id);

    if (row === undefined) throw new Error(`No user ${id} in the fake`);

    row.blocked = true;
  }

  isBlocked(id: string): boolean {
    return this.rows.get(id)?.blocked ?? false;
  }

  /** The join `findByHash` does through the relation, without a query to write. */
  get(id: string): User {
    const row = this.rows.get(id);

    if (row === undefined) throw new Error(`No user ${id} in the fake`);

    return row.user;
  }

  private rowByEmail(email: string): UserCredentials | undefined {
    return [...this.rows.values()].find((row) => row.user.email === email);
  }
}

type FakeTokenRow = {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

class FakeRefreshTokenRepository implements PublicOf<RefreshTokenRepository> {
  readonly rows: FakeTokenRow[] = [];

  constructor(private readonly userRepository: FakeUserRepository) {}

  create(userId: string, token: IssuedRefreshToken): Promise<void> {
    this.rows.push({
      id: token.jti,
      userId,
      familyId: token.familyId,
      tokenHash: token.hash,
      expiresAt: token.expiresAt,
      revokedAt: null,
    });

    return Promise.resolve();
  }

  findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    const row = this.rows.find(
      (candidate) => candidate.tokenHash === tokenHash,
    );

    if (row === undefined) return Promise.resolve(null);

    return Promise.resolve({
      id: row.id,
      familyId: row.familyId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      user: this.userRepository.get(row.userId),
      userBlocked: this.userRepository.isBlocked(row.userId),
    });
  }

  rotate(
    spentId: string,
    userId: string,
    next: IssuedRefreshToken,
  ): Promise<boolean> {
    const spent = this.rows.find((row) => row.id === spentId);

    if (spent === undefined || spent.revokedAt !== null) {
      return Promise.resolve(false);
    }

    spent.revokedAt = new Date();

    return this.create(userId, next).then(() => true);
  }

  revokeFamily(familyId: string): Promise<void> {
    for (const row of this.rows) {
      if (row.familyId === familyId && row.revokedAt === null) {
        row.revokedAt = new Date();
      }
    }

    return Promise.resolve();
  }

  deleteExpired(userId: string): Promise<void> {
    const now = Date.now();

    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      const row = this.rows[index];

      if (
        row !== undefined &&
        row.userId === userId &&
        row.expiresAt.getTime() < now
      ) {
        this.rows.splice(index, 1);
      }
    }

    return Promise.resolve();
  }

  /** Writes a row no code path would produce, so the sweep can be told what to spare. */
  seed(row: Omit<FakeTokenRow, "tokenHash"> & { tokenHash?: string }): void {
    // Not a spread over the default: an explicit `tokenHash: undefined` would overwrite it.
    this.rows.push({ ...row, tokenHash: row.tokenHash ?? randomUUID() });
  }

  family(familyId: string): FakeTokenRow[] {
    return this.rows.filter((row) => row.familyId === familyId);
  }
}

describe("AuthService", () => {
  let service: AuthService;
  let tokenService: TokenService;
  let userRepository: FakeUserRepository;
  let refreshTokenRepository: FakeRefreshTokenRepository;

  beforeEach(async () => {
    userRepository = new FakeUserRepository();
    refreshTokenRepository = new FakeRefreshTokenRepository(userRepository);

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AuthService,
        TokenService,
        { provide: AUTH_CONFIG, useValue: config },
        { provide: UserRepository, useValue: userRepository },
        { provide: RefreshTokenRepository, useValue: refreshTokenRepository },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    tokenService = moduleRef.get(TokenService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function storedCredentials(): UserCredentials {
    const row = [...userRepository.rows.values()][0];

    if (row === undefined) throw new Error("No user was stored");

    return row;
  }

  function storedToken(): FakeTokenRow {
    const [row] = refreshTokenRepository.rows;

    if (row === undefined) throw new Error("No refresh token was stored");

    return row;
  }

  describe("register", () => {
    it("stores a verifiable argon2 hash instead of the password", async () => {
      const result = await service.register(credentials);

      const { passwordHash } = storedCredentials();

      expect(passwordHash).not.toContain(credentials.password);
      await expect(
        argon2.verify(passwordHash, credentials.password),
      ).resolves.toBe(true);
      // The answer carries the contract user and nothing from the row beyond it.
      expect(result.user).toEqual({
        id: expect.any(String) as string,
        email: credentials.email,
        role: "USER",
        createdAt: expect.any(String) as string,
      });
    });

    it("stores only the hash of the refresh token, never the token", async () => {
      const result = await service.register(credentials);

      const [row] = refreshTokenRepository.rows;

      expect(row?.userId).toBe(result.user.id);
      expect(row?.tokenHash).toBe(
        tokenService.hash(result.tokens.refreshToken),
      );
      expect(row?.tokenHash).not.toBe(result.tokens.refreshToken);
    });

    it("turns the unique violation on the email into 409", async () => {
      await service.register(credentials);

      await expect(service.register(credentials)).rejects.toThrow(
        ConflictException,
      );
    });

    it("keeps a stored session when the sweep of expired rows fails", async () => {
      const logged = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);

      jest
        .spyOn(refreshTokenRepository, "deleteExpired")
        .mockRejectedValueOnce(new Error("the connection went away"));

      // The user and the refresh row are already written by this point: answering the
      // request with a 500 would hide a registration that in fact succeeded.
      const result = await service.register(credentials);

      expect(result.user.email).toBe(credentials.email);
      expect(refreshTokenRepository.rows).toHaveLength(1);
      expect(logged).toHaveBeenCalled();
    });
  });

  describe("login", () => {
    it("answers the same way for an unknown email and a wrong password", async () => {
      await service.register(credentials);

      const sessions = refreshTokenRepository.rows.length;

      await expect(
        service.login({ email: "nobody@example.com", password: "password123" }),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.login({ email: credentials.email, password: "wrong-password" }),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshTokenRepository.rows).toHaveLength(sessions);
    });

    it("spends an argon2 verification on an unknown email too, so the clock tells no tales", async () => {
      const started = process.hrtime.bigint();

      await expect(
        service.login({ email: "nobody@example.com", password: "password123" }),
      ).rejects.toThrow(UnauthorizedException);

      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;

      // The repositories are in memory here, so nothing else in this path costs
      // milliseconds: only a real argon2 verification can push it past the bound.
      // Returning early instead would answer in under 2 ms where a registered address
      // takes 30 — and that difference is the list of registered addresses the shared
      // message is meant to withhold.
      expect(elapsed).toBeGreaterThan(10);
    });

    it("refuses a blocked account only once the password is right", async () => {
      const registered = await service.register(credentials);
      const sessions = refreshTokenRepository.rows.length;

      userRepository.block(registered.user.id);

      // A wrong password still reads as any other wrong password: the block is news only
      // to somebody who already knows the account exists.
      await expect(
        service.login({ email: credentials.email, password: "wrong-password" }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(service.login(credentials)).rejects.toThrow(
        ForbiddenException,
      );

      expect(refreshTokenRepository.rows).toHaveLength(sessions);
    });

    it("opens a session for the right password", async () => {
      const registered = await service.register(credentials);

      const result = await service.login(credentials);

      expect(result.user.id).toBe(registered.user.id);
      expect(refreshTokenRepository.rows).toHaveLength(2);
    });
  });

  describe("refresh", () => {
    it("revokes the presented token and issues a successor in the same family", async () => {
      const session = await service.register(credentials);
      const spent = refreshTokenRepository.rows[0];

      const result = await service.refresh(session.tokens.refreshToken);

      expect(spent?.revokedAt).toBeInstanceOf(Date);
      expect(result.tokens.refreshToken).not.toBe(session.tokens.refreshToken);

      const successor = refreshTokenRepository.rows.find(
        (row) => row.id !== spent?.id,
      );

      expect(successor?.familyId).toBe(spent?.familyId);
      expect(successor?.tokenHash).toBe(
        tokenService.hash(result.tokens.refreshToken),
      );
    });

    it("kills the whole family when a token that was already rotated comes back", async () => {
      const session = await service.register(credentials);
      const familyId = refreshTokenRepository.rows[0]?.familyId ?? "";

      await service.refresh(session.tokens.refreshToken);

      // The same token a second time: whoever holds the copy is indistinguishable from
      // the real user, so the chain ends for both of them.
      await expect(
        service.refresh(session.tokens.refreshToken),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshTokenRepository.family(familyId)).toHaveLength(2);
      expect(
        refreshTokenRepository
          .family(familyId)
          .every((row) => row.revokedAt !== null),
      ).toBe(true);
    });

    it("fails a refresh that lost the race without ending the family", async () => {
      const session = await service.register(credentials);
      const familyId = refreshTokenRepository.rows[0]?.familyId ?? "";

      // What a double-clicked button produces: the row was still live when it was read
      // and revoked by the parallel request before this one got to write.
      jest.spyOn(refreshTokenRepository, "rotate").mockResolvedValueOnce(false);

      await expect(
        service.refresh(session.tokens.refreshToken),
      ).rejects.toThrow(UnauthorizedException);

      // Both halves matter: the presented token stays usable, and no successor was left
      // behind for a chain that never advanced.
      expect(refreshTokenRepository.family(familyId)).toHaveLength(1);
      expect(
        refreshTokenRepository
          .family(familyId)
          .every((row) => row.revokedAt === null),
      ).toBe(true);
    });

    it("rejects a token signed with another key without touching the database", async () => {
      const lookup = jest.spyOn(refreshTokenRepository, "findByHash");

      await expect(service.refresh("not-a-token")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it("rejects a valid signature with no row behind it", async () => {
      const user = await service.register(credentials);
      // Signed by the real key, never stored — a session that was logged out, or a user
      // whose rows are gone.
      const orphan = await tokenService.issuePair(user.user);

      await expect(service.refresh(orphan.refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("ends the family of a token that outlived the block of its account", async () => {
      const session = await service.register(credentials);
      const familyId = refreshTokenRepository.rows[0]?.familyId ?? "";

      // Blocking deletes the rows; one that is still here was written by a login that
      // raced the block, and it must not mint another week.
      userRepository.block(session.user.id);

      await expect(
        service.refresh(session.tokens.refreshToken),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshTokenRepository.family(familyId)).toHaveLength(1);
      expect(
        refreshTokenRepository
          .family(familyId)
          .every((row) => row.revokedAt !== null),
      ).toBe(true);
    });

    it("rejects a missing cookie", async () => {
      await expect(service.refresh(null)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejects a row that expired early without ending the family", async () => {
      const session = await service.register(credentials);
      const stored = storedToken();

      // A signature that is still valid over a row that is not: the JWT carries its own
      // expiry, so only a row whose lifetime was cut short another way lands here. That
      // is an expiry rather than a replay, and an expiry ends one token, not the chain.
      stored.expiresAt = new Date(Date.now() - 1000);

      await expect(
        service.refresh(session.tokens.refreshToken),
      ).rejects.toThrow(UnauthorizedException);

      expect(stored.revokedAt).toBeNull();
      expect(refreshTokenRepository.family(stored.familyId)).toHaveLength(1);
    });

    it("deletes the expired rows of that user, and only the expired ones", async () => {
      const session = await service.register(credentials);
      const userId = session.user.id;
      const familyId = refreshTokenRepository.rows[0]?.familyId ?? "";

      const expired = randomUUID();
      const revokedButLive = randomUUID();

      refreshTokenRepository.seed({
        id: expired,
        userId,
        familyId,
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: new Date(),
      });
      // Revoked and still within its lifetime: this is the row that recognises a replay,
      // so the sweep has to leave it alone.
      refreshTokenRepository.seed({
        id: revokedButLive,
        userId,
        familyId,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
      });
      // Another user's expired row: the sweep is scoped to one user, not to the table.
      const stranger = await userRepository.create({
        email: "other@example.com",
        passwordHash: "hash",
      });
      const strangersExpired = randomUUID();

      refreshTokenRepository.seed({
        id: strangersExpired,
        userId: stranger.id,
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
      });

      await service.refresh(session.tokens.refreshToken);

      const remaining = refreshTokenRepository.rows.map((row) => row.id);

      expect(remaining).not.toContain(expired);
      expect(remaining).toContain(revokedButLive);
      expect(remaining).toContain(strangersExpired);
    });
  });

  describe("findById", () => {
    it("treats a vanished user as an ended session rather than a missing resource", async () => {
      await expect(service.findById(randomUUID())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("treats a blocked account as an ended session while its access token is still signed", async () => {
      const session = await service.register(credentials);

      userRepository.block(session.user.id);

      await expect(service.findById(session.user.id)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("logout", () => {
    it("revokes the family the token belongs to", async () => {
      const session = await service.register(credentials);
      const familyId = refreshTokenRepository.rows[0]?.familyId ?? "";

      await service.logout(session.tokens.refreshToken);

      expect(
        refreshTokenRepository
          .family(familyId)
          .every((row) => row.revokedAt !== null),
      ).toBe(true);
    });

    it("stays silent when there is no usable token — logging out cannot fail", async () => {
      const session = await service.register(credentials);
      const familyId = refreshTokenRepository.rows[0]?.familyId ?? "";

      await expect(service.logout(null)).resolves.toBeUndefined();
      await expect(service.logout("not-a-token")).resolves.toBeUndefined();

      expect(
        refreshTokenRepository
          .family(familyId)
          .every((row) => row.revokedAt === null),
      ).toBe(true);
      expect(session.tokens.refreshToken).not.toBe("");
    });
  });
});
