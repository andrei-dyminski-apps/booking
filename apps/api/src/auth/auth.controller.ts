import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
} from "@nestjs/common";
import { Throttle, minutes } from "@nestjs/throttler";
import type { Response } from "express";
import type { User } from "@repo/contracts";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config";
import { AuthService, type AuthResult } from "./auth.service";
import type { AuthenticatedUser } from "./auth.types";
import { clearAuthCookies, setAuthCookies } from "./cookies";
import { CurrentUser } from "./decorators/current-user.decorator";
import { Public } from "./decorators/public.decorator";
import { RefreshToken } from "./decorators/refresh-token.decorator";
import { LoginDto, RegisterDto } from "./dto/auth.dto";

/**
 * The tokens never appear in a response body — they leave only as httpOnly cookies, so
 * the browser is the one place they are stored and no client can put them in localStorage.
 *
 * Guessing a password and harvesting addresses both come down to volume, so the two
 * endpoints that answer such a guess carry a limit far below the rest of the API. It stays
 * off /auth/me and /auth/refresh, which a legitimate client calls often. The bucket is per
 * address (`req.ip`), which is the real client only when `TRUST_PROXY` matches the
 * deployment — otherwise everything behind the proxy shares one.
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
  ) {}

  @Public()
  @Throttle({ default: { ttl: minutes(1), limit: 10 } })
  @Post("register")
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<User> {
    return this.respondWithSession(res, await this.authService.register(dto));
  }

  @Public()
  @Throttle({ default: { ttl: minutes(1), limit: 10 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<User> {
    return this.respondWithSession(res, await this.authService.login(dto));
  }

  /**
   * Public because the access token is expected to be expired here — the refresh cookie is
   * the credential, and AuthService is what validates it.
   */
  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @RefreshToken() token: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<User> {
    try {
      return this.respondWithSession(
        res,
        await this.authService.refresh(token),
      );
    } catch (error) {
      // A refresh that fails is a session that cannot be repaired — after reuse detection
      // the whole family is gone. Leaving the dead cookie in the browser makes the client
      // retry a credential that can never work again, so the failure clears it too.
      clearAuthCookies(res, this.authConfig);
      throw error;
    }
  }

  /** Public for the same reason, and idempotent: the cookies are cleared either way. */
  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @RefreshToken() token: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(token);
    clearAuthCookies(res, this.authConfig);
  }

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser): Promise<User> {
    return this.authService.findById(user.id);
  }

  private respondWithSession(res: Response, result: AuthResult): User {
    setAuthCookies(res, this.authConfig, result.tokens);

    return result.user;
  }
}
