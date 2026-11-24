import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { Throttle, minutes } from "@nestjs/throttler";
import {
  ApiAcceptedResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import type { User } from "@repo/contracts";
import { ApiErrorDto } from "../common/dto/api-error.dto";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config";
import { AuthService, type AuthResult } from "./auth.service";
import type { AuthenticatedUser } from "./auth.types";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearAuthCookie,
  clearAuthCookies,
  readCookie,
  setAuthCookies,
} from "./cookies";
import { CurrentUser } from "./decorators/current-user.decorator";
import { Public } from "./decorators/public.decorator";
import { RefreshToken } from "./decorators/refresh-token.decorator";
import {
  AuthRequestAcceptedDto,
  CompleteRegistrationDto,
  ConfirmEmailChangeDto,
  LoginDto,
  RegisterDto,
  RequestEmailChangeDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
  UserDto,
} from "./dto/auth.dto";
import { TokenService } from "./token.service";

/**
 * The tokens never appear in a response body — they leave only as httpOnly cookies, so
 * the browser is the one place they are stored and no client can put them in localStorage.
 *
 * Guessing a password and harvesting addresses both come down to volume, so the two
 * endpoints that answer such a guess carry a limit far below the rest of the API. It stays
 * off /auth/me and /auth/refresh, which a legitimate client calls often. The bucket is per
 * address (`req.ip`), which is the real client only when `TRUST_PROXY` matches the
 * deployment: too low and everything behind the proxy shares one bucket, too high and the
 * caller picks its own with a header.
 */
@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
  ) {}

  @Public()
  @Throttle({ default: { ttl: minutes(1), limit: 10 } })
  @Post("register")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Request an email link to create an account" })
  @ApiAcceptedResponse({ type: AuthRequestAcceptedDto })
  async register(@Body() dto: RegisterDto): Promise<AuthRequestAcceptedDto> {
    await this.authService.register(dto);
    return { accepted: true };
  }

  @Public()
  @Throttle({ default: { ttl: minutes(1), limit: 10 } })
  @Post("register/complete")
  @ApiOperation({ summary: "Create an account after verifying its email" })
  @ApiCreatedResponse({ type: UserDto })
  async completeRegistration(
    @Body() dto: CompleteRegistrationDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<User> {
    return this.respondWithSession(
      res,
      await this.authService.completeRegistration(dto),
    );
  }

  @Public()
  @Throttle({ default: { ttl: minutes(10), limit: 5 } })
  @Post("password/reset/request")
  @ApiOperation({ summary: "Request a password reset link" })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ type: AuthRequestAcceptedDto })
  async requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
  ): Promise<AuthRequestAcceptedDto> {
    await this.authService.requestPasswordReset(dto.email);
    return { accepted: true };
  }

  @Public()
  @Throttle({ default: { ttl: minutes(10), limit: 5 } })
  @Post("password/reset/complete")
  @ApiOperation({ summary: "Set a new password using the emailed reset link" })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const userId = await this.authService.resetPassword(dto);
    await this.clearRevokedCookies(req, res, userId);
  }

  @Throttle({ default: { ttl: minutes(10), limit: 5 } })
  @Post("email/change/request")
  @ApiOperation({ summary: "Request confirmation at a new email address" })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ type: AuthRequestAcceptedDto })
  async requestEmailChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestEmailChangeDto,
  ): Promise<AuthRequestAcceptedDto> {
    await this.authService.requestEmailChange(user.id, dto);
    return { accepted: true };
  }

  @Public()
  @Throttle({ default: { ttl: minutes(10), limit: 5 } })
  @Post("email/change/complete")
  @ApiOperation({ summary: "Confirm a new email address and end old sessions" })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async confirmEmailChange(
    @Body() dto: ConfirmEmailChangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const userId = await this.authService.confirmEmailChange(dto.token);
    await this.clearRevokedCookies(req, res, userId);
  }

  @Public()
  @Throttle({ default: { ttl: minutes(1), limit: 10 } })
  @Post("login")
  @ApiOperation({ summary: "Log in and start a session" })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UserDto })
  @ApiUnauthorizedResponse({
    description: "Invalid email or password",
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: "The password is right and an admin has blocked the account",
    type: ApiErrorDto,
  })
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
  @ApiOperation({
    summary: "Rotate the refresh token and issue a new access token",
  })
  // Public to the guard and read by the service: the refresh cookie is the credential.
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UserDto })
  @ApiUnauthorizedResponse({
    description:
      "The refresh token is missing, invalid, expired, or already used, or its account has been blocked",
    type: ApiErrorDto,
  })
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
  @ApiOperation({ summary: "End the session and clear its cookies" })
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async logout(
    @RefreshToken() token: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(token);
    clearAuthCookies(res, this.authConfig);
  }

  @Get("me")
  @ApiOperation({ summary: "The signed-in account" })
  @ApiOkResponse({ type: UserDto })
  @ApiUnauthorizedResponse({
    description: "Session no longer exists, or its account has been blocked",
    type: ApiErrorDto,
  })
  me(@CurrentUser() user: AuthenticatedUser): Promise<User> {
    return this.authService.findById(user.id);
  }

  private async clearRevokedCookies(
    req: Request,
    res: Response,
    userId: string,
  ): Promise<void> {
    // A public link may be opened in a browser signed in to another account.
    const accessToken = readCookie(req, ACCESS_TOKEN_COOKIE);
    const refreshToken = readCookie(req, REFRESH_TOKEN_COOKIE);
    const [access, refresh] = await Promise.all([
      accessToken && this.tokenService.verifyAccessToken(accessToken),
      refreshToken && this.tokenService.verifyRefreshToken(refreshToken),
    ]);
    if (access && access.sub === userId)
      clearAuthCookie(res, this.authConfig, ACCESS_TOKEN_COOKIE);
    if (refresh && refresh.sub === userId)
      clearAuthCookie(res, this.authConfig, REFRESH_TOKEN_COOKIE);
  }

  private respondWithSession(res: Response, result: AuthResult): User {
    setAuthCookies(res, this.authConfig, result.tokens);

    return result.user;
  }
}
