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
import {
  AdminAccountError,
  CallerNotAdminError,
  UserRepository,
} from "./user.repository";

/**
 * Managing accounts is the admin's, and the controller says so with `@Roles`. What is left
 * for the service is what the guard cannot answer: whether the row is one an admin may act
 * on at all, and, for a change, whether the role the token claims is still the role the
 * caller's account has.
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

  /** One account, an admin's included: reading it changes nothing. */
  async findOne(id: string): Promise<ManagedUserDetail> {
    const user = await this.userRepository.findDetailById(id);

    if (user === null) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return user;
  }

  /**
   * Blocks or reopens an account.
   *
   * **Not an admin's.** The API grants no role, so an admin account is made outside it,
   * and one admin cannot shut another out — nor themselves. It is a `403` because it is
   * the same kind of refusal ownership gives: the endpoint is the caller's, this row is not
   * one they may act on.
   *
   * A block deletes the account's refresh tokens, so no refresh comes, and the access
   * token it holds is the whole of what is left — for up to `JWT_ACCESS_TTL`.
   *
   * **Not on a stale token.** The sessions a block deletes do not come back with a reopen,
   * so the caller's own row is read in the write's transaction (see
   * `UserRepository.update`), and an admin demoted or blocked since the token was issued is
   * refused with the `403` the guard would give them after their next refresh.
   */
  async update(
    actor: AuthenticatedUser,
    id: string,
    change: UpdateUserInput,
  ): Promise<ManagedUser> {
    let updated: ManagedUser | null;

    try {
      updated = await this.userRepository.update(actor.id, id, change);
    } catch (error) {
      if (error instanceof AdminAccountError) {
        throw new ForbiddenException("Admin accounts cannot be blocked");
      }

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
