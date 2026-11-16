import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { apiException } from "./api-exception";

/**
 * The signed token is good but the account behind it is not: deleted, or blocked since the
 * token was issued. 401 rather than 404, because it sends the client to the login form
 * instead of leaving it retrying a request that can never succeed.
 */
export function sessionNotFound(): Error {
  return apiException(
    UnauthorizedException,
    "SESSION_NOT_FOUND",
    "Session no longer exists",
  );
}

/** An admin-only action by a session whose account has lost the role since the token was signed. */
export function notAnAdminAnymore(): Error {
  return apiException(
    ForbiddenException,
    "NOT_AN_ADMIN_ANYMORE",
    "Your account is no longer an admin's",
  );
}
