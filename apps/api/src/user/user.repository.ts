import { Injectable } from "@nestjs/common";
import {
  Role,
  UserStatus,
  type ManagedUser,
  type ManagedUserDetail,
  type UpdateUserInput,
  type User,
  type UserQuery,
} from "@repo/contracts";
import { Prisma, type User as UserRow } from "../generated/prisma/client";
import type { Page } from "../common/paging";
import { STILL_OFFERED } from "../listing/listing.repository";
import { escapeLike } from "../prisma/escape-like";
import { PrismaService } from "../prisma/prisma.service";
import type { UserCursor } from "./user-cursor";

/**
 * What `update` throws for an admin's account: the API grants no role and takes none away,
 * so an admin account is out of reach of the block as well — no admin can shut another out.
 */
export class AdminAccountError extends Error {
  constructor(id: string) {
    super(`User ${id} is an admin, and an admin account cannot be blocked`);
    this.name = "AdminAccountError";
  }
}

/**
 * What `update` throws when the account behind the caller's token is no longer an active
 * admin: its role or its block was written in the database after the token was issued, or
 * its owner erased it, and `JwtStrategy` reads no database, so the token still claims
 * `ADMIN`.
 */
export class CallerNotAdminError extends Error {
  constructor(callerId: string) {
    super(`User ${callerId} is no longer an active admin`);
    this.name = "CallerNotAdminError";
  }
}

/**
 * The columns a page and an account's own page are built from — the hash is not one of
 * them, and a list of fifty accounts has no reason to carry fifty of those.
 */
const MANAGED_USER = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  blockedAt: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

type ManagedUserRow = Prisma.UserGetPayload<{ select: typeof MANAGED_USER }>;

/**
 * The hash is kept beside the contract user rather than inside it: a flat shape would let
 * a `return { user }` carry the password hash into a response body, and neither the types
 * nor the review would notice.
 */
export type UserCredentials = {
  user: User;
  passwordHash: string;
  sessionVersion: number;
  /** Whether an admin shut the account; the password is checked first either way. */
  blocked: boolean;
};

@Injectable()
export class UserRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async hasSessionVersion(id: string, version: number): Promise<boolean> {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      select: { sessionVersion: true },
    });
    return user?.sessionVersion === version;
  }

  /**
   * The reads that carry the hash; everything else leaves on the contract shape. An erased
   * account is not found: its address is a placeholder by then, and the read says so on
   * its own rather than trusting nobody to type one.
   */
  async findByEmail(email: string): Promise<UserCredentials | null> {
    const row = await this.prismaService.user.findFirst({
      where: { email, deletedAt: null },
    });

    if (row === null) return null;

    return {
      user: toUser(row),
      passwordHash: row.passwordHash,
      sessionVersion: row.sessionVersion,
      blocked: row.blockedAt !== null,
    };
  }

  /**
   * The hash of the account behind a session, for a password typed again to confirm
   * something that cannot be undone (`DELETE /users/me`); `null` where `findActiveById`
   * finds no session.
   */
  async findPasswordHashById(id: string): Promise<string | null> {
    const row = await this.prismaService.user.findFirst({
      where: { id, blockedAt: null, deletedAt: null },
      select: { passwordHash: true },
    });

    return row?.passwordHash ?? null;
  }

  /**
   * The account behind a session, or `null` when there is none to be behind one — the row
   * is gone, its owner erased it, or an admin blocked it. `/auth/me` reads through this, so
   * a blocked user's shell turns signed-out at the next render rather than when their
   * access token lapses.
   */
  async findActiveById(id: string): Promise<User | null> {
    const row = await this.prismaService.user.findFirst({
      where: { id, blockedAt: null, deletedAt: null },
    });

    return row === null ? null : toUser(row);
  }

  /**
   * One account as its own page shows it, blocked or not, with what it has behind it. The
   * two counts are subqueries of the same read rather than two more round trips, and the
   * listings are counted under `STILL_OFFERED` — the condition `ListingRepository` reads
   * every listing under, so the count and the list a link opens cannot disagree.
   */
  async findDetailById(id: string): Promise<ManagedUserDetail | null> {
    const row = await this.prismaService.user.findUnique({
      where: { id },
      select: {
        ...MANAGED_USER,
        _count: {
          select: { bookings: true, listings: { where: STILL_OFFERED } },
        },
      },
    });

    if (row === null) return null;

    return {
      ...toManagedUser(row),
      bookingCount: row._count.bookings,
      listingCount: row._count.listings,
    };
  }

  /**
   * One page of accounts: the filters and the keyset cursor as two conditions of one
   * `AND`, and `limit + 1` rows so the caller learns whether there is another page without
   * a second `count` — the shape `BookingRepository.findPage` reads in.
   */
  async findPage(
    query: UserQuery,
    cursor: UserCursor | null,
  ): Promise<Page<ManagedUser>> {
    const filters = userFilters(query);
    if (cursor) {
      filters.push(
        Prisma.sql`(created_at, id) ${cursor.sort === "newest" ? Prisma.sql`<` : Prisma.sql`>`}
          (${cursor.createdAt}::timestamp, ${cursor.id}::uuid)`,
      );
    }
    const where =
      filters.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
        : Prisma.empty;
    const order = query.sort === "newest" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const rows = await this.prismaService.$queryRaw<ManagedUserRow[]>`
      SELECT id, name, email::text AS email, role, created_at AS "createdAt",
        blocked_at AS "blockedAt", deleted_at AS "deletedAt"
      FROM users
      ${where}
      ORDER BY created_at ${order}, id ${order}
      LIMIT ${query.limit + 1}
    `;

    return {
      items: rows.slice(0, query.limit).map(toManagedUser),
      hasMore: rows.length > query.limit,
    };
  }

  /**
   * The block, in one transaction — and blocking reaches into `refresh_tokens` from here
   * rather than through `RefreshTokenRepository`, because the two writes are one decision:
   * an account marked blocked with its refresh tokens still in place could mint a session
   * for a week, and tokens deleted from an account the update then failed to mark would
   * sign somebody out for nothing. A `where` may cross between repositories; no row of
   * that table is mapped here.
   *
   * The tokens are deleted rather than revoked. A revoked row is kept to recognise a
   * replay, and a replay of a blocked account's token is not a theft to detect — it is a
   * session that no longer exists, which an absent row already says.
   *
   * Blocking an account that is already blocked keeps the moment it was first blocked:
   * that is when access ended, and a second click does not move it. The condition is the
   * `where` of the write rather than a read before it, so two blocks at once cannot both
   * find the column empty — under `READ COMMITTED` the second waits for the first's row
   * lock, re-checks `blocked_at IS NULL` and writes nothing.
   *
   * The caller's row is read first, in the same transaction: the role in the token is the
   * row's as it was at issue, and a block cannot be undone for the sessions it deletes, so
   * an admin demoted or blocked since by a write outside the API, or one who erased their
   * own account since, gets no change through (`CallerNotAdminError`).
   *
   * Only a `USER`'s row is written, and the role is part of the write's `where` rather than
   * a read before it, so a promotion committed meanwhile cannot slip between the check and
   * the write. A write that matched holds the row lock until the commit, so the read back
   * sees the role it was written against; one that matched nothing — an admin's row, a
   * block already in place, no row at all — is told apart by that read. The refresh tokens
   * are deleted only after it, so an admin's sessions are never touched. `null` is a row
   * that does not exist, or one its owner erased: there is no account left to block, and
   * the `deleted_at` in the write's `where` keeps a block from stamping it.
   */
  async update(
    callerId: string,
    id: string,
    change: UpdateUserInput,
  ): Promise<ManagedUser | null> {
    return this.prismaService.$transaction(async (tx) => {
      const caller = await tx.user.findUnique({
        where: { id: callerId },
        select: { role: true, blockedAt: true, deletedAt: true },
      });

      if (
        caller?.role !== Role.ADMIN ||
        caller.blockedAt !== null ||
        caller.deletedAt !== null
      ) {
        throw new CallerNotAdminError(callerId);
      }

      await tx.user.updateMany({
        where: change.blocked
          ? { id, role: Role.USER, blockedAt: null, deletedAt: null }
          : { id, role: Role.USER, deletedAt: null },
        data: { blockedAt: change.blocked ? new Date() : null },
      });

      const row = await tx.user.findUnique({
        where: { id },
        select: MANAGED_USER,
      });

      if (row === null || row.deletedAt !== null) return null;

      if (row.role === Role.ADMIN) throw new AdminAccountError(id);

      if (change.blocked) {
        await tx.refreshToken.deleteMany({ where: { userId: id } });
        await tx.mailReplyToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return toManagedUser(row);
    });
  }
}

function userFilters(query: UserQuery): Prisma.Sql[] {
  const filters: Prisma.Sql[] = [];
  if (query.role !== undefined)
    filters.push(Prisma.sql`role = ${query.role}::"Role"`);
  if (query.name !== undefined)
    filters.push(Prisma.sql`name ILIKE ${`%${escapeLike(query.name)}%`}`);
  // The trigram index serves the text operator. Prisma emits ILIKE directly on citext.
  if (query.email !== undefined)
    filters.push(
      Prisma.sql`email::text ILIKE ${`%${escapeLike(query.email)}%`}`,
    );
  if (query.status !== undefined) filters.push(statusFilter(query.status));
  return filters;
}

/**
 * An erased account is neither of the other two —
 * nobody signs in to it and nobody can reopen it — so `ACTIVE` leaves it out as `BLOCKED`
 * does. The switch is exhaustive, so a fourth status stops compiling here.
 */
function statusFilter(status: NonNullable<UserQuery["status"]>): Prisma.Sql {
  switch (status) {
    case UserStatus.ACTIVE:
      return Prisma.sql`blocked_at IS NULL AND deleted_at IS NULL`;
    case UserStatus.BLOCKED:
      return Prisma.sql`blocked_at IS NOT NULL AND deleted_at IS NULL`;
    case UserStatus.DELETED:
      return Prisma.sql`deleted_at IS NOT NULL`;
  }
}

/** Exported for RefreshTokenRepository, which reads the user row through its relation. */
export function toUser(
  row: Pick<UserRow, "id" | "name" | "email" | "role" | "createdAt">,
): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The same row as an admin is shown it — the session's shape plus when it was blocked or erased. */
function toManagedUser(row: ManagedUserRow): ManagedUser {
  return {
    ...toUser(row),
    blockedAt: row.blockedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}
