import type { Listing, ListingSort } from "@repo/contracts";
import { encodeParts } from "../common/paging";
import { decodeCursor, encodeCursor } from "./catalogue-cursor";

const listing: Listing = {
  id: "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f",
  ownerId: "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50",
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNight: 120.5,
  capacity: 4,
  createdAt: "2026-08-20T12:00:00.000Z",
  updatedAt: "2026-08-20T12:00:00.000Z",
};

/** A cursor of this resource, spelled by hand — with the resource tag the envelope adds. */
const raw = (...parts: (string | number)[]): string =>
  Buffer.from(["listings", ...parts].join("|")).toString("base64url");

/**
 * A cursor arrives in a URL, so it is untrusted input: what it becomes is a `where` on the
 * catalogue query, and a half-read one would answer a different question than the one
 * asked. Everything below is therefore about what it refuses.
 */
describe("catalogue cursor", () => {
  it("carries the key its ordering sorts by, the id, and the ordering itself", () => {
    expect(decodeCursor(encodeCursor(listing, "newest"))).toEqual({
      sort: "newest",
      createdAt: new Date(listing.createdAt),
      id: listing.id,
    });
    expect(decodeCursor(encodeCursor(listing, "oldest"))).toEqual({
      sort: "oldest",
      createdAt: new Date(listing.createdAt),
      id: listing.id,
    });
    expect(decodeCursor(encodeCursor(listing, "priceAsc"))).toEqual({
      sort: "priceAsc",
      pricePerNight: listing.pricePerNight,
      id: listing.id,
    });
    expect(decodeCursor(encodeCursor(listing, "priceDesc"))).toEqual({
      sort: "priceDesc",
      pricePerNight: listing.pricePerNight,
      id: listing.id,
    });
  });

  it("says nothing about the ordering to whoever reads it", () => {
    const cursor = encodeCursor(listing, "newest");

    expect(cursor).not.toContain(listing.id);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuses anything it did not write", () => {
    for (const value of [
      "",
      "not-a-cursor",
      // The triple the cursor carried before the envelope named the resource: it parses
      // as base64 and names a place, but not one this API can read any more.
      Buffer.from(["newest", listing.createdAt, listing.id].join("|")).toString(
        "base64url",
      ),
      // A sort nobody offers, the halves the wrong way round, a fifth field, one half
      // alone, and an id that is not one: each parses as base64 and none of them is a
      // place in the catalogue.
      raw("cheapest", listing.pricePerNight, listing.id),
      raw(listing.id, listing.createdAt, "newest"),
      raw("newest", listing.createdAt, listing.id, "extra"),
      raw("newest", listing.createdAt),
      raw("newest", listing.createdAt, "not-a-uuid"),
    ]) {
      expect(decodeCursor(value)).toBeNull();
    }
  });

  /**
   * Every list of this API spells its cursor the same way, and a `newest` one is a
   * timestamp and a uuid whichever list issued it. Without the resource in the envelope a
   * cursor of the stays would decode here as a perfectly good place in the catalogue, and
   * the answer would be a page of a question nobody asked rather than the `400` a cursor
   * from somewhere else deserves.
   */
  it("refuses a cursor another list of this API issued", () => {
    expect(
      decodeCursor(
        encodeParts("bookings", "newest", listing.createdAt, listing.id),
      ),
    ).toBeNull();
  });

  /**
   * The key is read against the rule the contract writes for the column it comes from, so
   * a cursor cannot name a value no listing could hold — and the two keys are not
   * interchangeable: a timestamp where a price belongs would become a `NaN` comparison,
   * and a price where a timestamp belongs an `Invalid Date` one. Both compare false
   * against every row, so an unread cursor would answer an empty catalogue.
   */
  it("refuses a key the column it names could not hold", () => {
    for (const sort of ["newest", "oldest"] satisfies ListingSort[]) {
      expect(decodeCursor(raw(sort, listing.pricePerNight, listing.id))).toBe(
        null,
      );
      expect(decodeCursor(raw(sort, "2026-08-20", listing.id))).toBeNull();
    }

    for (const sort of ["priceAsc", "priceDesc"] satisfies ListingSort[]) {
      expect(decodeCursor(raw(sort, listing.createdAt, listing.id))).toBe(null);
      expect(decodeCursor(raw(sort, 0, listing.id))).toBeNull();
      expect(decodeCursor(raw(sort, 1.5, listing.id))).toBeNull();
      expect(decodeCursor(raw(sort, "1000000.01", listing.id))).toBeNull();
    }
  });

  /**
   * A price has one spelling here, the one `encodeCursor` writes. Every value below is the
   * same number said another way, so a lenient read would take all of them — and a cursor
   * this API never issued is a mistake whatever it evaluates to, the same way a timestamp
   * off by a character is.
   */
  it("refuses a price it did not spell itself", () => {
    for (const key of [
      "1.205e2",
      " 120.50 ",
      "120.500",
      "120.5",
      "120",
      "+120.50",
    ]) {
      expect(decodeCursor(raw("priceAsc", key, listing.id))).toBeNull();
    }
  });
});
