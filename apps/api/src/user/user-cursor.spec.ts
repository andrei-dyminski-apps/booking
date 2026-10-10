import { Role, type ManagedUser, type UserSort } from "@repo/contracts";
import { encodeParts } from "../common/paging";
import { decodeCursor, encodeCursor } from "./user-cursor";

const user: ManagedUser = {
  id: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
  name: "Guest",
  email: "guest@example.com",
  role: Role.USER,
  createdAt: "2026-08-20T12:00:00.000Z",
  blockedAt: null,
};

/** A cursor of this resource, spelled by hand — with the resource tag the envelope adds. */
const raw = (...parts: string[]): string =>
  Buffer.from(["users", ...parts].join("|")).toString("base64url");

/** Untrusted input like the other two cursors, so what matters is what it refuses. */
describe("user cursor", () => {
  it("carries the moment the account was created, the id, and the ordering", () => {
    for (const sort of ["newest", "oldest"] satisfies UserSort[]) {
      expect(decodeCursor(encodeCursor(user, sort))).toEqual({
        sort,
        createdAt: new Date(user.createdAt),
        id: user.id,
      });
    }
  });

  it("does not spell the account out to whoever reads it", () => {
    const cursor = encodeCursor(user, "newest");

    expect(cursor).not.toContain(user.id);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuses anything it did not write", () => {
    for (const value of [
      "",
      "not-a-cursor",
      raw("byEmail", user.createdAt, user.id),
      raw("newest", "yesterday", user.id),
      raw("newest", user.createdAt, "not-a-uuid"),
      raw("newest", user.createdAt),
      raw("newest", user.createdAt, user.id, "extra"),
    ]) {
      expect(decodeCursor(value)).toBeNull();
    }
  });

  /** A `newest` cursor of the stays is a timestamp and a uuid too; the tag tells them apart. */
  it("refuses a cursor another list of this API issued", () => {
    expect(
      decodeCursor(encodeParts("bookings", "newest", user.createdAt, user.id)),
    ).toBeNull();
  });
});
