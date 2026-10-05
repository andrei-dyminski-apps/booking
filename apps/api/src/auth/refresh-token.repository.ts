import { Injectable } from "@nestjs/common";
import type { User } from "@repo/contracts";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { IssuedRefreshToken } from "./auth.types";
import { toUser } from "../user/user.repository";

/** A stored token together with its owner: every refresh needs both. */
export type StoredRefreshToken = {
  id: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: User;
  /** Whether an admin has blocked the account since this token was issued. */
  userBlocked: boolean;
};

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async create(userId: string, token: IssuedRefreshToken): Promise<void> {
    await this.prismaService.refreshToken.create({
      data: toRow(userId, token),
    });
  }

  async findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    const row = await this.prismaService.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (row === null) return null;

    return {
      id: row.id,
      familyId: row.familyId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      user: toUser(row.user),
      userBlocked: row.user.blockedAt !== null,
    };
  }

  /**
   * Burns the presented token and writes its successor in one transaction — the successor
   * must never exist without the predecessor being spent, or a replay would go unnoticed.
   *
   * `false` means the row was already revoked between the read and this write: two
   * parallel refreshes of one token, which the caller answers without ending the family.
   * The conditional `where` is what makes that a decision of the database rather than of
   * two requests that both read `revokedAt: null` a moment apart.
   */
  async rotate(
    spentId: string,
    userId: string,
    next: IssuedRefreshToken,
  ): Promise<boolean> {
    return this.prismaService.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { id: spentId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (count === 0) return false;

      await tx.refreshToken.create({ data: toRow(userId, next) });

      return true;
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prismaService.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Rotation leaves the spent row behind, so a session refreshed every 15 minutes writes
   * about a hundred rows a day and nothing ever removes them. Only expired rows go: a
   * revoked one still has work to do until then, because recognising a replay is exactly
   * what it is kept for.
   *
   * Scoped to one user and driven off `@@index([userId, expiresAt])` — a sweep of the
   * whole table belongs to a scheduled job, which arrives with BullMQ in phase 4.
   */
  async deleteExpired(userId: string): Promise<void> {
    await this.prismaService.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });
  }
}

function toRow(
  userId: string,
  token: IssuedRefreshToken,
): Prisma.RefreshTokenUncheckedCreateInput {
  return {
    id: token.jti,
    userId,
    familyId: token.familyId,
    tokenHash: token.hash,
    expiresAt: token.expiresAt,
  };
}
