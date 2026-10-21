import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@repo/contracts";
import type { AuthenticatedUser } from "../auth.types";
import { Roles } from "../decorators/roles.decorator";
import { RolesGuard } from "./roles.guard";

/**
 * The decorator is applied for real rather than stubbed through the Reflector: what is
 * being tested is the pair, and metadata written under a key nobody reads would pass a
 * test that mocks the reading.
 */
class TestController {
  // `this: void` on each: the handlers are read off the instance and handed to the guard
  // as plain values, which is what Nest does with them too — the annotation says so and
  // keeps @typescript-eslint/unbound-method from reading it as a lost binding.
  @Roles(Role.USER)
  userOnly(this: void): void {}

  @Roles(Role.USER, Role.ADMIN)
  userOrAdmin(this: void): void {}

  @Roles(Role.ADMIN)
  adminOnly(this: void): void {}

  unrestricted(this: void): void {}
}

const userWith = (role: Role): AuthenticatedUser => ({
  id: "0b6f7f6e-2f4c-4a52-9a5e-8f1f6d2c3b4a",
  email: "guest@example.com",
  role,
});

const contextFor = (
  handler: () => void,
  user: AuthenticatedUser | undefined,
): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe("RolesGuard", () => {
  const guard = new RolesGuard(new Reflector());
  const controller = new TestController();

  it("lets a route without @Roles through, whatever the role", () => {
    for (const role of [Role.USER, Role.ADMIN]) {
      expect(
        guard.canActivate(contextFor(controller.unrestricted, userWith(role))),
      ).toBe(true);
    }
  });

  it("admits the role the route names", () => {
    expect(
      guard.canActivate(contextFor(controller.userOnly, userWith(Role.USER))),
    ).toBe(true);
  });

  it("admits any of several named roles", () => {
    for (const role of [Role.USER, Role.ADMIN]) {
      expect(
        guard.canActivate(contextFor(controller.userOrAdmin, userWith(role))),
      ).toBe(true);
    }
  });

  it("is set membership rather than a hierarchy — an admin fails a user-only route", () => {
    expect(() =>
      guard.canActivate(contextFor(controller.userOnly, userWith(Role.ADMIN))),
    ).toThrow(ForbiddenException);
  });

  it("refuses a role the route does not name", () => {
    expect(() =>
      guard.canActivate(contextFor(controller.adminOnly, userWith(Role.USER))),
    ).toThrow(ForbiddenException);
  });

  it("answers 401 when @Roles guards a route nobody authenticated for", () => {
    expect(() =>
      guard.canActivate(contextFor(controller.userOnly, undefined)),
    ).toThrow(UnauthorizedException);
  });
});
