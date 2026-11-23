import { Inject, Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import type { Request } from "express";
import { ExtractJwt, Strategy } from "passport-jwt";
import { sessionNotFound } from "../common/session-errors";
import { UserRepository } from "../user/user.repository";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config";
import type { AccessTokenPayload, AuthenticatedSession } from "./auth.types";
import { ACCESS_TOKEN_COOKIE, readCookie } from "./cookies";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    @Inject(AUTH_CONFIG) authConfig: AuthConfig,
    private readonly users: UserRepository,
  ) {
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

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedSession> {
    const sessionVersion = payload.sessionVersion ?? 0;
    if (!(await this.users.hasSessionVersion(payload.sub, sessionVersion)))
      throw sessionNotFound();
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      sessionVersion,
    };
  }
}
