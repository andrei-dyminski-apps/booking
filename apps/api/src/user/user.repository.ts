import { Injectable } from "@nestjs/common";
import {
  Role,
  UserStatus,
  type ManagedUser,
  type ManagedUserDetail,
  type UpdateUserInput,
  type User,
  type UserQuery,
  type UserSort,
} from "@repo/contracts";
import { z } from "zod";
import { type Prisma, type User as UserRow } from "../generated/prisma/client";
import { afterCreatedAt, CREATED_AT_ORDER, type Page } from "../common/paging";
import { STILL_OFFERED } from "../listing/listing.repository";
import {
  isPrismaError,
  PrismaErrorCode,
  violatedConstraint,
} from "../prisma/prisma.errors";
import { PrismaService } from "../prisma/prisma.service";
import type { UserCursor } from "./user-cursor";

/**
 * What `create` throws instead of letting a Prisma error code reach the service. Which
 * driver reports a unique violation, and under which code, is exactly the knowledge this
 * layer exists to keep on its own side.
 */
export class EmailAlreadyRegisteredError extends Error {
  constructor(email: string) {
    super(`Email ${email} is already registered`);
    this.name = "EmailAlreadyRegisteredError";
  }
}

/**
 * What `update` throws when the account behind the caller's token is no longer an active
 * admin, read under the same lock the write takes — see `update` for why it is checked
 * there rather than by the service beforehand.
 */
export class CallerNotAdminError extends Error {
  constructor(callerId: string) {
    super(`User ${callerId} is no longer an active admin`);
    this.name = "CallerNotAdminError";
  }
}

/** One row of the `FOR UPDATE` read in `update` — raw SQL, so the columns keep their stored names. */
type LockedUser = { id: string; role: Role; blocked_at: Date | null };

/**
 * The columns a page and an account's own page are built from — the hash is not one of
 * them, and a list of fifty accounts has no reason to carry fifty of those.
 */
const MANAGED_USER = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  blockedAt: true,
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
  /** Whether an admin shut the account; the password is checked first either way. */
  blocked: boolean;
};

@Injectable()
export class UserRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async create(input: { email: string; passwordHash: string }): Promise<User> {
    try {
      return toUser(await this.prismaService.user.create({ data: input }));
    } catch (error) {
      // The unique index decides, not a preceding SELECT: two simultaneous registrations
      // of the same address would both pass such a check.
      if (
        isPrismaError(error, PrismaErrorCode.UniqueViolation) &&
        conflictsOnEmail(error)
      ) {
        throw new EmailAlreadyRegisteredError(input.email);
      }

      throw error;
    }
  }

  /** The only read that carries the hash; everything else leaves on the contract shape. */
  async findByEmail(email: string): Promise<UserCredentials | null> {
    const row = await this.prismaService.user.findUnique({ where: { email } });

    if (row === null) return null;

    return {
      user: toUser(row),
      passwordHash: row.passwordHash,
      blocked: row.blockedAt !== null,
    };
  }

  /**
   * The account behind a session, or `null` when there is none to be behind one — the row
   * is gone, or an admin blocked it. `/auth/me` reads through this, so a blocked user's
   * shell turns signed-out at the next render rather than when their access token lapses.
   */
  async findActiveById(id: string): Promise<User | null> {
    const row = await this.prismaService.user.findFirst({
      where: { id, blockedAt: null },
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
    const rows = await this.prismaService.user.findMany({
      where: {
        AND: [
          userFilters(query),
          ...(cursor === null ? [] : [afterCreatedAt(cursor)]),
        ],
      },
      orderBy: ORDER_BY[query.sort],
      take: query.limit + 1,
      select: MANAGED_USER,
    });

    return {
      items: rows.slice(0, query.limit).map(toManagedUser),
      hasMore: rows.length > query.limit,
    };
  }

  /**
   * The role, the block, or both, in one transaction — and blocking reaches into
   * `refresh_tokens` from here rather than through `RefreshTokenRepository`, because the
   * two writes are one decision: an account marked blocked with its refresh tokens still
   * in place could mint a session for a week, and tokens deleted from an account the
   * update then failed to mark would sign somebody out for nothing. A `where` may cross
   * between repositories; no row of that table is mapped here.
   *
   * The tokens are deleted rather than revoked. A revoked row is kept to recognise a
   * replay, and a replay of a blocked account's token is not a theft to detect — it is a
   * session that no longer exists, which an absent row already says.
   *
   * Blocking an account that is already blocked keeps the moment it was first blocked:
   * that is when access ended, and a second click does not move it. The condition is the
   * `where` of the write rather than a read before it, so two blocks at once cannot both
   * find the column empty — under `READ COMMITTED` the second waits for the first's row
   * lock, re-checks `blocked_at IS NULL` and writes nothing. `null` is a row that does not
   * exist, or was deleted on the way.
   *
   * The caller's row is locked together with the target's, and read under that lock: an
   * admin who was just blocked or demoted must not get one more change through on the
   * access token they still hold. A read before the transaction would not do — two admins
   * blocking each other at once would both find the other still active, and the site would
   * be left with no admin to undo it. Locked here, the second change waits for the first,
   * then finds its own caller blocked and throws `CallerNotAdminError`. Both rows are taken
   * in one statement ordered by id, so two such changes cannot lock them in opposite orders
   * and deadlock.
   */
  async update(
    callerId: string,
    id: string,
    change: UpdateUserInput,
  ): Promise<ManagedUser | null> {
    try {
      return await this.prismaService.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<LockedUser[]>`
          SELECT id, role, blocked_at FROM users
          WHERE id IN (${callerId}::uuid, ${id}::uuid)
          ORDER BY id
          FOR UPDATE
        `;
        const caller = locked.find((row) => row.id === callerId);

        if (caller?.role !== Role.ADMIN || caller.blocked_at !== null) {
          throw new CallerNotAdminError(callerId);
        }

        if (!locked.some((row) => row.id === id)) return null;

        if (change.blocked === true) {
          await tx.user.updateMany({
            where: { id, blockedAt: null },
            data: { blockedAt: new Date() },
          });
          await tx.refreshToken.deleteMany({ where: { userId: id } });
        }

        // `undefined` is how Prisma spells "leave the column alone": the block was either
        // just written above or not asked about.
        const row = await tx.user.update({
          where: { id },
          data: {
            role: change.role,
            blockedAt: change.blocked === false ? null : undefined,
          },
          select: MANAGED_USER,
        });

        return toManagedUser(row);
      });
    } catch (error) {
      if (isPrismaError(error, PrismaErrorCode.RecordNotFound)) return null;

      throw error;
    }
  }
}

/**
 * The filters of `GET /users`, as a `where`. The address is a substring match — what an
 * admin remembers of somebody's address is a part of it — and a case-sensitive one: the
 * contract lower-cases the filter, and every stored address was lower-cased the same way
 * at registration, so an `ILIKE` would only add a `lower()` per row. No index serves it;
 * the table is read in the order of the one index it has, and the filter narrows that
 * walk.
 */
function userFilters(query: UserQuery): Prisma.UserWhereInput {
  return {
    role: query.role,
    email:
      query.email === undefined
        ? undefined
        : { contains: escapeLike(query.email) },
    ...(query.status === undefined
      ? {}
      : {
          blockedAt: query.status === UserStatus.BLOCKED ? { not: null } : null,
        }),
  };
}

/**
 * Prisma hands a `contains` to `LIKE` as it is, so `_` and `%` in what an admin typed would
 * match any character and any run of them — `john_doe` would find `johnxdoe` and `%` every
 * account. The backslash is the default escape character of `LIKE`, so it is escaped too.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * The ordering of each sort, and the index the migration `block_users_and_page_them`
 * declares (`created_at DESC, id DESC`) — the pair every list here shares, so changing it
 * means changing that index and `CREATED_AT_ORDER` in `common/paging.ts` with it.
 */
const ORDER_BY: Record<UserSort, Prisma.UserOrderByWithRelationInput[]> =
  CREATED_AT_ORDER;

/** A unique violation names the columns it happened on; the path there is the shared one. */
const uniqueConstraintSchema = z.object({ fields: z.array(z.string()) });

/**
 * `email` is the only unique column on the model today, so this is not what makes the
 * answer right — it is what keeps it right once a second one arrives: a conflict on a
 * future `username` must not come back to its owner as a taken email address.
 *
 * A constraint this cannot read counts as the email: the model has no other unique column
 * to confuse it with, and answering a duplicate registration with a 500 would be a worse
 * mistake than naming the wrong field in a case that does not exist yet. `bookings` has
 * two candidate keys and therefore takes the opposite decision — see `violatedConstraint`.
 */
function conflictsOnEmail(
  error: Prisma.PrismaClientKnownRequestError,
): boolean {
  const constraint = violatedConstraint(error, uniqueConstraintSchema);

  return constraint === null || constraint.fields.includes("email");
}

/** Exported for RefreshTokenRepository, which reads the user row through its relation. */
export function toUser(
  row: Pick<UserRow, "id" | "email" | "role" | "createdAt">,
): User {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The same row as an admin is shown it — the session's shape plus when it was blocked. */
function toManagedUser(row: ManagedUserRow): ManagedUser {
  return {
    ...toUser(row),
    blockedAt: row.blockedAt?.toISOString() ?? null,
  };
}
