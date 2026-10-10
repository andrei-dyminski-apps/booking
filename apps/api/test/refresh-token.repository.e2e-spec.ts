import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import type { IssuedRefreshToken } from "./../src/auth/auth.types";
import { RefreshTokenRepository } from "./../src/auth/refresh-token.repository";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";

/**
 * The rotation transaction is the one part of the module the unit spec cannot reach: it
 * fakes the repositories, so the conditional update that decides between two refreshes of
 * one token is never executed there. It cannot be provoked through HTTP either — whether
 * the second request reads the row before or after the first one burns it is a matter of
 * timing, and reading it after is a replay rather than a race. Called directly, the
 * decision is the database's alone and the outcome is the same however the two interleave.
 */
describe("RefreshTokenRepository (e2e)", () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let refreshTokenRepository: RefreshTokenRepository;
  let userId: string;
  let familyId: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prismaService = app.get(PrismaService);
    refreshTokenRepository = app.get(RefreshTokenRepository);

    await resetDatabase(app);

    const user = await prismaService.user.create({
      data: {
        name: "Rotation",
        email: "rotation@example.com",
        passwordHash: "hash",
      },
    });

    userId = user.id;
    familyId = randomUUID();
  });

  afterEach(async () => {
    await app.close();
  });

  /** What TokenService hands over, without signing a token nothing here verifies. */
  function issued(): IssuedRefreshToken {
    return {
      jti: randomUUID(),
      familyId,
      hash: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    };
  }

  it("lets exactly one of two parallel rotations of the same row through", async () => {
    const spent = issued();

    await refreshTokenRepository.create(userId, spent);

    const outcomes = await Promise.all([
      refreshTokenRepository.rotate(spent.jti, userId, issued()),
      refreshTokenRepository.rotate(spent.jti, userId, issued()),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);

    const rows = await prismaService.refreshToken.findMany({
      where: { userId },
    });

    // One successor, not two: the loser's transaction wrote nothing, so the family is not
    // left holding a second live token that no client was ever handed.
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
  });

  it("refuses to rotate a row that is already spent", async () => {
    const spent = issued();

    await refreshTokenRepository.create(userId, spent);
    await refreshTokenRepository.revokeFamily(familyId);

    await expect(
      refreshTokenRepository.rotate(spent.jti, userId, issued()),
    ).resolves.toBe(false);

    // The refusal is the whole point: a successor written on top of a revoked predecessor
    // is a session that survived its own reuse detection.
    await expect(
      prismaService.refreshToken.count({ where: { userId } }),
    ).resolves.toBe(1);
  });

  it("deletes the expired rows of the user and spares the revoked ones", async () => {
    const live = issued();
    const expired = { ...issued(), expiresAt: new Date(Date.now() - 1000) };

    await refreshTokenRepository.create(userId, live);
    await refreshTokenRepository.create(userId, expired);
    await refreshTokenRepository.revokeFamily(familyId);
    await refreshTokenRepository.deleteExpired(userId);

    // Revoked but unexpired is exactly the row a replay is recognised by, so the sweep
    // goes by `expiresAt` alone — the index it runs on names nothing else.
    const remaining = await prismaService.refreshToken.findMany({
      where: { userId },
    });

    expect(remaining.map((row) => row.id)).toEqual([live.jti]);
  });
});
