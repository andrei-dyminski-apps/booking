import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Role } from "@repo/contracts";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config";
import type {
  AccessTokenPayload,
  IssuedRefreshToken,
  RefreshTokenPayload,
} from "./auth.types";

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  refresh: IssuedRefreshToken;
};

type TokenSubject = { id: string; email: string; role: Role };

/**
 * Signing and hashing only: nothing here touches the database, so the rotation rules stay
 * in AuthService and this stays testable without one.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
  ) {}

  /**
   * `familyId` is passed in when an existing chain is being rotated and omitted on a fresh
   * login — the two cases differ only by that.
   */
  async issuePair(user: TokenSubject, familyId?: string): Promise<TokenPair> {
    const jti = randomUUID();
    const family = familyId ?? randomUUID();

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      jti,
      fam: family,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.authConfig.accessSecret,
        expiresIn: this.authConfig.accessTtl,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.authConfig.refreshSecret,
        expiresIn: this.authConfig.refreshTtl,
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      refresh: {
        jti,
        familyId: family,
        hash: this.hash(refreshToken),
        // The row expires with the token, so an expired session is also expired storage.
        expiresAt: new Date(Date.now() + this.authConfig.refreshTtl * 1000),
      },
    };
  }

  /** Returns null for a forged, tampered or expired token — the caller answers 401 either way. */
  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
    try {
      return await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.authConfig.refreshSecret,
      });
    } catch {
      return null;
    }
  }

  /**
   * SHA-256 rather than argon2: the token is 200+ bits of signed randomness, so there is
   * no dictionary to slow down, and the digest has to be looked up by equality on every
   * refresh — which a salted password hash cannot be.
   */
  hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
