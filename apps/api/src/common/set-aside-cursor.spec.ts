import { z } from "zod";
import { encodeParts } from "./paging";
import { decodeSetAsideCursor, encodeSetAsideCursor } from "./set-aside-cursor";

const RESOURCE = "payment-events-failed";

/** The provider's ids are text; a stay's is a uuid. */
const TEXT_ID = z.string();
const UUID_ID = z.uuid();

const row = { at: "2026-10-25T14:35:00.000Z", id: "evt_1Pq2Rs3Tu4" };

/** A cursor of this resource, spelled by hand — with the resource tag the envelope adds. */
const raw = (...parts: string[]): string =>
  Buffer.from([RESOURCE, ...parts].join("|")).toString("base64url");

/** Untrusted input like every cursor here, so what matters is what it refuses. */
describe("set-aside cursor", () => {
  it("carries the moment the row was set aside, its id, and the ordering", () => {
    expect(
      decodeSetAsideCursor(
        RESOURCE,
        encodeSetAsideCursor(RESOURCE, row, "newest"),
        TEXT_ID,
      ),
    ).toEqual({ sort: "newest", at: new Date(row.at), id: row.id });
  });

  it("refuses anything it did not write", () => {
    for (const value of [
      "",
      "not-a-cursor",
      raw("oldest", row.at, row.id),
      raw("newest", "yesterday", row.id),
      raw("newest", row.at, ""),
      raw("newest", row.at),
      raw("newest", row.at, row.id, "extra"),
    ]) {
      expect(decodeSetAsideCursor(RESOURCE, value, TEXT_ID)).toBeNull();
    }
  });

  /** A stay's id is a uuid column, and a query handed anything else fails as a `500`. */
  it("refuses an id the list's column could not hold", () => {
    expect(
      decodeSetAsideCursor(RESOURCE, raw("newest", row.at, row.id), UUID_ID),
    ).toBeNull();
    expect(
      decodeSetAsideCursor(
        RESOURCE,
        raw("newest", row.at, "3a4b5c6d-7e8f-4091-8a2b-3c4d5e6f7a8b"),
        UUID_ID,
      ),
    ).toEqual({
      sort: "newest",
      at: new Date(row.at),
      id: "3a4b5c6d-7e8f-4091-8a2b-3c4d5e6f7a8b",
    });
  });

  /** The three lists spell a cursor alike; the tag is what keeps one out of another. */
  it("refuses a cursor another list issued", () => {
    expect(
      decodeSetAsideCursor(
        RESOURCE,
        encodeParts("bookings-stuck-refund", "newest", row.at, row.id),
        TEXT_ID,
      ),
    ).toBeNull();
  });
});
