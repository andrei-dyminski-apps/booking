import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { REFRESH_TOKEN_COOKIE, readCookie } from "../cookies";

/** The refresh token as the browser sent it, or null — the service decides what that means. */
export const RefreshToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null =>
    readCookie(
      context.switchToHttp().getRequest<Request>(),
      REFRESH_TOKEN_COOKIE,
    ),
);
