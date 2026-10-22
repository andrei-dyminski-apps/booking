import type { WaitlistDemandEntry } from "@repo/contracts";
import { encodeParts } from "../common/paging";
import { decodeCursor, encodeCursor } from "./waitlist-cursor";

const entry: WaitlistDemandEntry = {
  id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  listingId: "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f",
  listing: { title: "Loft above the harbour", pricePerNight: 120 },
  from: "2026-09-01",
  to: "2026-09-05",
  createdAt: "2026-08-20T12:00:00.000Z",
  waiter: null,
};

const raw = (...parts: string[]): string =>
  Buffer.from(["waitlist", ...parts].join("|")).toString("base64url");

/** What the parse refuses, for the reason `booking-cursor.spec.ts` gives. */
describe("waitlist cursor", () => {
  it("carries the key its ordering sorts by, the id, and the ordering itself", () => {
    expect(decodeCursor(encodeCursor(entry, "newest"))).toEqual({
      sort: "newest",
      createdAt: new Date(entry.createdAt),
      id: entry.id,
    });
    expect(decodeCursor(encodeCursor(entry, "checkInAsc"))).toEqual({
      sort: "checkInAsc",
      from: new Date("2026-09-01T00:00:00.000Z"),
      id: entry.id,
    });
  });

  it("refuses anything it did not write", () => {
    for (const value of [
      "",
      "not-a-cursor",
      raw("checkInDesc", entry.from, entry.id),
      raw("newest", entry.from, entry.id),
      raw("checkInAsc", entry.createdAt, entry.id),
      raw("newest", entry.createdAt, "not-a-uuid"),
      raw("newest", entry.createdAt),
    ]) {
      expect(decodeCursor(value)).toBeNull();
    }
  });

  it("refuses a cursor the stays issued, although it is spelled alike", () => {
    expect(
      decodeCursor(
        encodeParts("bookings", "newest", entry.createdAt, entry.id),
      ),
    ).toBeNull();
  });
});
