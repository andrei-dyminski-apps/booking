import { randomBytes } from "node:crypto";
import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import type { LoginInput, RegisterInput, User } from "@repo/contracts";
import * as argon2 from "argon2";
import { isPast } from "date-fns";
import { RefreshTokenRepository } from "./refresh-token.repository";
import { TokenService, type TokenPair } from "./token.service";
import { EmailAlreadyRegisteredError, UserRepository } from "./user.repository";

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
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    // argon2id is the default of the library and the memory-hard variant OWASP recommends;
    // spelling it out keeps a future change of that default from silently downgrading it.
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });

    let user: User;

    try {
      user = await this.userRepository.create({
        email: input.email,
        passwordHash,
      });
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        // Deliberately not the message of the error: it names the address back, which is
        // fine in a log and is a registered-address oracle in a response body.
        throw new ConflictException("Email is already registered");
      }

      throw error;
    }

    return this.startSession(user);
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
      throw new UnauthorizedException("Invalid email or password");
    }

    return this.startSession(found.user);
  }

  /**
   * Rotation: every refresh burns the token it was given and issues the next one in the
   * same family. A token that comes back after it was already burned means a copy of it
   * exists somewhere else — and since the two copies are indistinguishable, the only safe
   * answer is to end the whole chain and make the real user log in again.
   */
  async refresh(token: string | null): Promise<AuthResult> {
    if (token === null) {
      throw new UnauthorizedException("Refresh token is missing");
    }

    const payload = await this.tokenService.verifyRefreshToken(token);

    if (payload === null) {
      throw new UnauthorizedException("Refresh token is invalid or expired");
    }

    const stored = await this.refreshTokenRepository.findByHash(
      this.tokenService.hash(token),
    );

    // A valid signature with no row behind it: the session was ended, or the user is gone.
    if (stored === null) {
      throw new UnauthorizedException("Refresh token is not recognised");
    }

    if (stored.revokedAt !== null) {
      await this.refreshTokenRepository.revokeFamily(stored.familyId);
      throw new UnauthorizedException("Refresh token has already been used");
    }

    // The row outlives nothing: the JWT check above already rejects an expired token, and
    // this covers a row whose lifetime was cut short another way.
    if (isPast(stored.expiresAt)) {
      throw new UnauthorizedException("Refresh token is invalid or expired");
    }

    const issued = await this.tokenService.issuePair(
      stored.user,
      stored.familyId,
    );
    const rotated = await this.refreshTokenRepository.rotate(
      stored.id,
      stored.user.id,
      issued.refresh,
    );

    // Lost a race with a parallel refresh of the same token — a double-clicked button
    // rather than a replay, so the family survives and only this request fails.
    if (!rotated) {
      throw new UnauthorizedException("Refresh token has already been used");
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
   * can never succeed and would confirm that the token itself was good.
   */
  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);

    if (user === null) {
      throw new UnauthorizedException("Session no longer exists");
    }

    return user;
  }

  private async startSession(user: User): Promise<AuthResult> {
    const issued = await this.tokenService.issuePair(user);

    await this.refreshTokenRepository.create(user.id, issued.refresh);
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
