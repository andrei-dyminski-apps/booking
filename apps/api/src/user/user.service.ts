import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  type ManagedUser,
  type ManagedUserDetail,
  type UpdateUserInput,
  type UserPage,
  type UserQuery,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { readCursor } from "../common/paging";
import { decodeCursor, encodeCursor } from "./user-cursor";
import { CallerNotAdminError, UserRepository } from "./user.repository";

/**
 * Managing accounts is the admin's, and the controller says so with `@Roles`. What is left
 * for the service is what the guard cannot answer: which row — an admin does not act on
 * their own account — and, for a change, whether the role the token claims is still the
 * role the account has.
 */
@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  /**
   * One page of accounts. The cursor is this API's own, so an unreadable one is a `400`
   * rather than a silent first page — the reason `readCursor` states for every list.
   */
  async findPage(query: UserQuery): Promise<UserPage> {
    const cursor = readCursor(query.cursor, query.sort, decodeCursor);
    const { items, hasMore } = await this.userRepository.findPage(
      query,
      cursor,
    );
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last !== undefined ? encodeCursor(last, query.sort) : null,
    };
  }

  /**
   * One account, the admin's own included: reading it changes nothing, so the rule that
   * keeps an admin off their own row in `update` has nothing to guard here.
   */
  async findOne(id: string): Promise<ManagedUserDetail> {
    const user = await this.userRepository.findDetailById(id);

    if (user === null) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return user;
  }

  /**
   * Changes the role, the block, or both.
   *
   * **Not on oneself.** An admin who demotes or blocks their own account is a site that can
   * lose its last admin by one click, and nobody left could undo it. Another admin may — a
   * second pair of eyes is what makes the change deliberate. It is a `403` because it is
   * the same kind of refusal ownership gives: the endpoint is the caller's, this row is not
   * one they may act on.
   *
   * A changed role takes effect at the account's next refresh: `JwtStrategy` reads no
   * database, so the access token it holds keeps its old claim for up to `JWT_ACCESS_TTL`.
   * A block is not softer than that either way — it deletes the refresh tokens, so that
   * refresh never comes, and the access token is the whole of what is left.
   *
   * **Except for the caller of this route.** What is left of an admin who was just blocked
   * or demoted is an access token that may still block the admin who did it, or promote
   * somebody else — the one thing a block has to stop at once. So the caller's own row is
   * read under the lock the write takes (see `UserRepository.update`), and a token whose
   * account is no longer an active admin is refused with the `403` the guard would give it
   * after its next refresh.
   *
   * The id is compared lower-cased: `ParseUUIDPipe` lets an upper-case UUID through and
   * Postgres finds the same row by it, while the token carries the id as Postgres prints
   * it.
   */
  async update(
    actor: AuthenticatedUser,
    id: string,
    change: UpdateUserInput,
  ): Promise<ManagedUser> {
    if (id.toLowerCase() === actor.id.toLowerCase()) {
      throw new ForbiddenException(
        "Admins cannot change the role or the block of their own account",
      );
    }

    let updated: ManagedUser | null;

    try {
      updated = await this.userRepository.update(actor.id, id, change);
    } catch (error) {
      if (error instanceof CallerNotAdminError) {
        throw new ForbiddenException("Your account is no longer an admin's");
      }

      throw error;
    }

    if (updated === null) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return updated;
  }
}
