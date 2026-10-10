import { BookingStatus, type Booking, type BookingSort } from "@repo/contracts";
import { encodeParts } from "../common/paging";
import { decodeCursor, encodeCursor } from "./booking-cursor";

const booking: Booking = {
  id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  listingId: "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f",
  listing: { title: "Loft above the harbour", pricePerNight: 120.5 },
  guestId: "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50",
  from: "2026-09-01",
  to: "2026-09-05",
  status: BookingStatus.PENDING_PAYMENT,
  expiresAt: "2026-08-20T12:15:00.000Z",
  createdAt: "2026-08-20T12:00:00.000Z",
  reviewed: { byGuest: false, byOwner: false },
};

/** A cursor of this resource, spelled by hand — with the resource tag the envelope adds. */
const raw = (...parts: string[]): string =>
  Buffer.from(["bookings", ...parts].join("|")).toString("base64url");

/**
 * A cursor arrives in a URL, so it is untrusted input: what it becomes is a `where` on a
 * list of stays, and a half-read one would answer a different question than the one asked.
 * Everything below is therefore about what it refuses.
 */
describe("booking cursor", () => {
  it("carries the key its ordering sorts by, the id, and the ordering itself", () => {
    for (const sort of ["newest", "oldest"] satisfies BookingSort[]) {
      expect(decodeCursor(encodeCursor(booking, sort))).toEqual({
        sort,
        createdAt: new Date(booking.createdAt),
        id: booking.id,
      });
    }

    for (const sort of ["checkInAsc", "checkInDesc"] satisfies BookingSort[]) {
      expect(decodeCursor(encodeCursor(booking, sort))).toEqual({
        sort,
        // A calendar day names midnight UTC — the instant the `@db.Date` column holds.
        from: new Date("2026-09-01T00:00:00.000Z"),
        id: booking.id,
      });
    }
  });

  it("says nothing about the ordering to whoever reads it", () => {
    const cursor = encodeCursor(booking, "newest");

    expect(cursor).not.toContain(booking.id);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuses anything it did not write", () => {
    for (const value of [
      "",
      "not-a-cursor",
      // An ordering nobody offers, the halves the wrong way round, a fifth field, one
      // half alone, and an id that is not one: each parses as base64 and none of them is a
      // place in a list of stays.
      raw("soonest", booking.createdAt, booking.id),
      raw(booking.id, booking.createdAt, "newest"),
      raw("newest", booking.createdAt, booking.id, "extra"),
      raw("newest", booking.createdAt),
      raw("newest", booking.createdAt, "not-a-uuid"),
    ]) {
      expect(decodeCursor(value)).toBeNull();
    }
  });

  /**
   * The catalogue spells its cursor exactly the way this one does, and a `newest` key is a
   * timestamp on both sides — so without the resource in the envelope a cursor of the
   * listings would decode here as a good place in a list of stays, and the answer would be
   * a page of a question nobody asked rather than a `400`.
   */
  it("refuses a cursor another list of this API issued", () => {
    expect(
      decodeCursor(
        encodeParts("listings", "newest", booking.createdAt, booking.id),
      ),
    ).toBeNull();
  });

  /**
   * The key is read against the rule the contract writes for the column it names, and the
   * two keys are not interchangeable: a day where a moment belongs would compare as
   * midnight rather than as the moment the row was written, and a moment where a day
   * belongs is a value the `@db.Date` column never holds. Both would answer a page of a
   * list nobody asked for.
   */
  it("refuses a key the column it names could not hold", () => {
    for (const sort of ["newest", "oldest"] satisfies BookingSort[]) {
      expect(decodeCursor(raw(sort, booking.from, booking.id))).toBeNull();
      expect(decodeCursor(raw(sort, "yesterday", booking.id))).toBeNull();
    }

    for (const sort of ["checkInAsc", "checkInDesc"] satisfies BookingSort[]) {
      expect(decodeCursor(raw(sort, booking.createdAt, booking.id))).toBeNull();
      expect(decodeCursor(raw(sort, "2026-09-1", booking.id))).toBeNull();
      expect(decodeCursor(raw(sort, "2026-13-01", booking.id))).toBeNull();
    }
  });
});
