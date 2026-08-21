import { Inject, Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import type { Request } from "express";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config";
import type { AccessTokenPayload, AuthenticatedUser } from "./auth.types";
import { ACCESS_TOKEN_COOKIE, readCookie } from "./cookies";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(@Inject(AUTH_CONFIG) authConfig: AuthConfig) {
    super({
      // The token lives in an httpOnly cookie, so the Authorization header is not an
      // alternative source: accepting both would reopen the CSRF surface the cookie
      // attributes close, and Swagger gets the cookie from the browser anyway.
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => readCookie(request, ACCESS_TOKEN_COOKIE),
      ]),
      ignoreExpiration: false,
      secretOrKey: authConfig.accessSecret,
    });
  }

  /**
   * No database read per request — that is what a short-lived access token buys. A role
   * change therefore takes effect at the next refresh, and `JWT_ACCESS_TTL` is the upper
   * bound on that lag.
   */
  validate(payload: AccessTokenPayload): AuthenticatedUser {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
