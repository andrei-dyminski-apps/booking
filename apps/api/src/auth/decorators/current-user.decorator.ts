import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedUser } from "../auth.types";

/**
 * The payload JwtStrategy returned, without reaching for `req.user` at the call site.
 * Only reachable behind the guard — on a @Public() route there is nobody to inject.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<Request>();

    return request.user as AuthenticatedUser;
  },
);
