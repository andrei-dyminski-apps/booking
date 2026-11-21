import { randomBytes } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { OPEN_MATTER_MESSAGES, type DeleteAccountInput } from "@repo/contracts";
import * as argon2 from "argon2";
import type { AuthenticatedUser } from "../auth/auth.types";
import { apiException } from "../common/api-exception";
import { sessionNotFound } from "../common/session-errors";
import { UserRepository } from "../user/user.repository";
import {
  AccountGoneError,
  AccountRepository,
  LastAdminError,
  OpenMattersError,
} from "./account.repository";

/**
 * A person erasing their own account. The rules about what may still be open and the locks
 * they are read under are the repository's; what is left here is who may ask — the account's
 * own session, with its password typed again — and the words of each refusal.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly accountRepository: AccountRepository,
  ) {}

  /**
   * **The password, again.** A session alone — a tab left open, a stolen cookie — must not
   * be able to erase an account, so the request carries the password and argon2 checks it
   * before anything is read about the account's stays. A wrong one is a `403`, not the
   * login's `401`: the session is good, and a `401` would send the browser to refresh it
   * and sign the person out for a typo.
   *
   * An account with no session left to act for it — gone, blocked, erased already — is the
   * `401` of `/auth/me`, before the password and after it alike.
   *
   * The hash the password becomes is argon2's own over random bytes, made before the
   * transaction: nothing can match it, and a login that somehow reached the row would verify
   * against it as against any other rather than fail on a malformed one.
   */
  async deleteOwn(
    user: AuthenticatedUser,
    input: DeleteAccountInput,
  ): Promise<void> {
    const passwordHash = await this.userRepository.findPasswordHashById(
      user.id,
    );

    if (passwordHash === null) throw sessionNotFound();

    if (!(await argon2.verify(passwordHash, input.password))) {
      throw apiException(
        ForbiddenException,
        "PASSWORD_INCORRECT",
        "The password is not right",
      );
    }

    const placeholderHash = await argon2.hash(randomBytes(32).toString("hex"), {
      type: argon2.argon2id,
    });

    try {
      await this.accountRepository.erase(user.id, placeholderHash);
    } catch (error) {
      if (error instanceof OpenMattersError) {
        const { open, asGuest, asHost } = error.matters;
        const [first] = open;

        // The first matter's code and sentence, and every one open in `params` with the
        // sides it is open on, so the page can name them all instead of one per attempt
        // and link each to the half of the stays that holds it.
        throw apiException(
          ConflictException,
          first,
          OPEN_MATTER_MESSAGES[first],
          { open: [...open], asGuest: [...asGuest], asHost: [...asHost] },
        );
      }

      if (error instanceof LastAdminError) {
        throw apiException(
          ConflictException,
          "LAST_ADMIN_CANNOT_DELETE",
          "The site's last admin cannot delete their account",
        );
      }

      if (error instanceof AccountGoneError) throw sessionNotFound();

      throw error;
    }

    // The id alone: the name and the address are gone, and the log keeps no more of them.
    this.logger.log(`Account ${user.id} erased`);
  }
}
