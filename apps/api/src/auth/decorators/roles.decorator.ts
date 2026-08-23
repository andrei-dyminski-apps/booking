import { SetMetadata, applyDecorators } from "@nestjs/common";
import { ApiForbiddenResponse } from "@nestjs/swagger";
import type { Role } from "@repo/contracts";
import { ApiErrorDto } from "../../common/dto/api-error.dto";

export const ROLES_KEY = "roles";

/**
 * Closes a route to everyone whose role is not named. RolesGuard is registered globally
 * and does nothing without this metadata, so an endpoint stays open to every signed-in
 * user until it is marked — unlike authentication, where the guard closes everything and
 * `@Public()` opens it. That asymmetry is deliberate: "is there a session" has one right
 * default, "which roles" does not, and a guessed one would either lock out or let through.
 *
 * At least one role has to be named, because `@Roles()` would read like a restriction and
 * be none.
 *
 * The OpenAPI half comes with it, the way it does for `@Public()`: the document says which
 * roles the operation wants, so /docs cannot disagree with the guard.
 */
export const Roles = (...roles: [Role, ...Role[]]) =>
  applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    ApiForbiddenResponse({
      description: `Requires the role ${roles.join(" or ")}`,
      type: ApiErrorDto,
    }),
  );
