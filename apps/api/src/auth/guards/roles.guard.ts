import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@repo/contracts";
import type { Request } from "express";
import type { AuthenticatedUser } from "../auth.types";
import { ROLES_KEY } from "../decorators/roles.decorator";

/**
 * The first half of authorization: what kind of user may call this endpoint at all. It is
 * decided from the access token alone — no query, no row — which is why it fits a guard
 * and runs before the handler.
 *
 * The other half, whether this particular row belongs to this particular user, cannot be
 * decided before the row is read; it lives in the services, next to the read, and is
 * spelled out in `../ownership.ts`.
 *
 * Membership of a set, not a hierarchy: ADMIN does not pass an `@Roles(Role.USER)` check
 * by being senior to a user. A route that admins may use names ADMIN, so what a role can
 * reach is readable where the route is written rather than hidden in a comparison here —
 * and `@Roles(Role.USER)` on "create a booking" keeps meaning what it says instead of
 * quietly admitting the role above it. Being a host is not a role at all: it is owning a
 * listing, which only the row can tell.
 *
 * Registered globally in app.module.ts after JwtAuthGuard: guards run in registration
 * order, and this one reads what that one put on the request.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (required === undefined) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;

    // @Roles() on a route @Public() left open: there is nobody to check the role of, and
    // letting it through would be the exact opposite of what the decorator asks for. A
    // misconfiguration rather than a client mistake, so it fails loudly on the first call.
    if (user === undefined) {
      throw new UnauthorizedException("Authentication is required");
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `This endpoint requires the role ${required.join(" or ")}`,
      );
    }

    return true;
  }
}
