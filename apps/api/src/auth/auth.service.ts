import { setTimeout as delay } from "node:timers/promises";
import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  CompleteRegistrationInput,
  LoginInput,
  RegisterInput,
  RequestEmailChangeInput,
  ResetPasswordInput,
  User,
} from "@repo/contracts";
import * as argon2 from "argon2";
import { isPast } from "date-fns";
import { apiException } from "../common/api-exception";
import { RefreshTokenRepository } from "./refresh-token.repository";
import { TokenService, type TokenPair } from "./token.service";
import { UserRepository } from "../user/user.repository";
import {
  AccountMailRepository,
  DemoEmailChangeError,
} from "./account-mail.repository";
import { sessionNotFound } from "../common/session-errors";
import { RealtimeService } from "../realtime/realtime.service";

/**
 * What a blocked account is told when it tries to sign in or keep a session going — the
 * status differs (a login is forbidden, a refresh is a session that ended), the rule does not.
 */
function accountBlocked(
  Exception: typeof ForbiddenException | typeof UnauthorizedException,
): Error {
  return apiException(
    Exception,
    "ACCOUNT_BLOCKED",
    "This account has been blocked",
  );
}

/** Everything the controller needs: the body of the answer plus the tokens it turns into cookies. */
export type AuthResult = {
  user: User;
  tokens: TokenPair;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * What `login` verifies against when the address is unknown, so that both answers cost
   * one argon2 verification. Hashed once at construction, before the first request, and
   * of random bytes — no password can ever match it.
   */
  private readonly absentUserHash = argon2.hash(
    randomBytes(32).toString("hex"),
    { type: argon2.argon2id },
  );

  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly tokenService: TokenService,
    private readonly accountMail: AccountMailRepository,
    private readonly realtime: RealtimeService,
  ) {}

  async register(input: RegisterInput): Promise<void> {
    await Promise.all([
      delay(250),
      this.accountMail.requestRegistration(input.email, input.next),
    ]);
  }

  async completeRegistration(
    input: CompleteRegistrationInput,
  ): Promise<AuthResult> {
    if (!(await this.accountMail.hasActiveLink("register", input.token)))
      throw invalidAccountLink();

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    const user = await this.accountMail.register(
      input.token,
      input.name,
      passwordHash,
    );
    if (!user) throw invalidAccountLink();
    return this.startSession(user, 0);
  }

  async requestPasswordReset(email: string): Promise<void> {
    await Promise.all([delay(250), this.accountMail.requestReset(email)]);
  }

  async resetPassword(input: ResetPasswordInput): Promise<string> {
    if (!(await this.accountMail.hasActiveLink("reset", input.token)))
      throw invalidAccountLink();

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    const session = await this.accountMail.reset(input.token, passwordHash);
    if (!session) throw invalidAccountLink();
    await this.realtime.publish(session.userId, {
      type: "session.changed",
      sessionVersion: session.sessionVersion,
    });
    return session.userId;
  }

  async requestEmailChange(
    userId: string,
    input: RequestEmailChangeInput,
  ): Promise<void> {
    const credentials = await this.accountMail.credentials(userId);
    if (!credentials) throw sessionNotFound();
    if (!(await argon2.verify(credentials.passwordHash, input.password))) {
      throw apiException(
        ForbiddenException,
        "PASSWORD_INCORRECT",
        "The password is incorrect",
      );
    }
    try {
      await this.accountMail.requestChange(
        userId,
        credentials.passwordHash,
        credentials.sessionVersion,
        input.email,
      );
    } catch (error) {
      if (error instanceof DemoEmailChangeError)
        throw new ForbiddenException("Demo accounts cannot change email");
      throw error;
    }
  }

  async confirmEmailChange(token: string): Promise<string> {
    const session = await this.accountMail.changeEmail(token);
    if (!session) throw invalidAccountLink();
    await this.realtime.publish(session.userId, {
      type: "session.changed",
      sessionVersion: session.sessionVersion,
    });
    return session.userId;
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const found = await this.userRepository.findByEmail(input.email);

    // One message for both an unknown address and a wrong password: telling them apart
    // turns the login form into a list of registered users. The verification runs even
    // when there is no user, because the clock tells them apart just as well — skipping
    // argon2 for an unknown address answers in 2 ms where a real one takes 30.
    const matches = await argon2.verify(
      found?.passwordHash ?? (await this.absentUserHash),
      input.password,
    );

    if (found === null || !matches) {
      throw apiException(
        UnauthorizedException,
        "INVALID_CREDENTIALS",
        "Invalid email or password",
      );
    }

    // Only after the password: saying an account is blocked tells whoever hears it that
    // the address is registered, and the one person that is no news to is its owner.
    if (found.blocked) {
      throw accountBlocked(ForbiddenException);
    }

    return this.startSession(found.user, found.sessionVersion);
  }

  /**
   * Rotation: every refresh burns the token it was given and issues the next one in the
   * same family. A token that comes back after it was already burned means a copy of it
   * exists somewhere else — and since the two copies are indistinguishable, the only safe
   * answer is to end the whole chain and make the real user log in again.
   */
  async refresh(token: string | null): Promise<AuthResult> {
    if (token === null) {
      throw apiException(
        UnauthorizedException,
        "REFRESH_TOKEN_MISSING",
        "Refresh token is missing",
      );
    }

    const payload = await this.tokenService.verifyRefreshToken(token);

    if (payload === null) {
      throw apiException(
        UnauthorizedException,
        "REFRESH_TOKEN_INVALID",
        "Refresh token is invalid or expired",
      );
    }

    const stored = await this.refreshTokenRepository.findByHash(
      this.tokenService.hash(token),
    );

    // A valid signature with no row behind it: the session was ended, or the user is gone.
    if (stored === null) {
      throw apiException(
        UnauthorizedException,
        "REFRESH_TOKEN_UNKNOWN",
        "Refresh token is not recognised",
      );
    }

    // Blocking deletes every refresh row of the account, so a row that is still here was
    // written by a login that read the account a moment before it was blocked. The family
    // goes with it, and the answer is the one a dead session gets.
    if (stored.userBlocked) {
      await this.refreshTokenRepository.revokeFamily(stored.familyId);
      throw accountBlocked(UnauthorizedException);
    }

    if (stored.revokedAt !== null) {
      await this.refreshTokenRepository.revokeFamily(stored.familyId);
      throw apiException(
        UnauthorizedException,
        "REFRESH_TOKEN_REUSED",
        "Refresh token has already been used",
      );
    }

    // The row outlives nothing: the JWT check above already rejects an expired token, and
    // this covers a row whose lifetime was cut short another way.
    if (isPast(stored.expiresAt)) {
      throw apiException(
        UnauthorizedException,
        "REFRESH_TOKEN_INVALID",
        "Refresh token is invalid or expired",
      );
    }

    const issued = await this.tokenService.issuePair(
      stored.user,
      stored.familyId,
      stored.sessionVersion,
    );
    const rotated = await this.refreshTokenRepository.rotate(
      stored.id,
      stored.user.id,
      issued.refresh,
      stored.sessionVersion,
    );

    // Lost a race with a parallel refresh of the same token — a double-clicked button
    // rather than a replay, so the family survives and only this request fails.
    if (!rotated) {
      throw apiException(
        UnauthorizedException,
        "REFRESH_TOKEN_REUSED",
        "Refresh token has already been used",
      );
    }

    // Only once the successor is safely written: the sweep of dead rows must not hold
    // locks the next refresh of this user waits on.
    await this.sweepExpired(stored.user.id);

    return { user: stored.user, tokens: issued };
  }

  /** Idempotent: an absent, forged or expired token still ends up with cleared cookies. */
  async logout(token: string | null): Promise<void> {
    if (token === null) return;

    const payload = await this.tokenService.verifyRefreshToken(token);

    if (payload === null) return;

    await this.refreshTokenRepository.revokeFamily(payload.fam);
  }

  /**
   * Read from the database rather than from the access token: the token is a snapshot up
   * to `JWT_ACCESS_TTL` old, and a profile page is exactly where that would show.
   *
   * A signed token whose row is gone is an ended session, not a missing resource — 401
   * sends the client to the login form, while 404 would leave it retrying a request that
   * can never succeed and would confirm that the token itself was good. A blocked
   * account is the same case: its access token is still signed for up to
   * `JWT_ACCESS_TTL`, and the session behind it is over.
   */
  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findActiveById(id);

    if (user === null) {
      throw sessionNotFound();
    }

    return user;
  }

  private async startSession(user: User, version: number): Promise<AuthResult> {
    const issued = await this.tokenService.issuePair(user, undefined, version);

    if (
      !(await this.refreshTokenRepository.create(
        user.id,
        issued.refresh,
        version,
      ))
    )
      throw sessionNotFound();
    await this.sweepExpired(user.id);

    return { user, tokens: issued };
  }

  /**
   * Housekeeping, and deliberately not fatal. It runs once the session is already stored,
   * so a failure here would answer a completed registration with a 500 — and after a
   * rotation it would be worse: the presented token is burned and its successor written,
   * so the caller would lose a session the database considers open. The rows it did not
   * remove are removed by the next login or rotation of the same user.
   */
  private async sweepExpired(userId: string): Promise<void> {
    try {
      await this.refreshTokenRepository.deleteExpired(userId);
    } catch (error) {
      this.logger.error(
        `Failed to delete the expired refresh tokens of user ${userId}`,
        error,
      );
    }
  }
}

function invalidAccountLink() {
  return apiException(
    BadRequestException,
    "ACCOUNT_LINK_INVALID",
    "This link is invalid or expired",
  );
}
