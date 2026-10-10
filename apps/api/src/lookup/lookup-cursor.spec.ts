import { LookupKind, type LookupOption } from "@repo/contracts";
import { encodeParts } from "../common/paging";
import { decodeCursor, encodeCursor } from "./lookup-cursor";

const option: LookupOption = {
  id: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
  label: "Loft | river view",
  hint: null,
};

const label = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64url");

/** A cursor of the listings lookup, spelled by hand — with the resource tag the envelope adds. */
const raw = (...parts: string[]): string =>
  Buffer.from(["lookup-listings", ...parts].join("|")).toString("base64url");

const decode = decodeCursor(LookupKind.listings);

/** Untrusted input like every other cursor, so what matters is what it refuses. */
describe("lookup cursor", () => {
  it("carries the name and the id, a separator in the name included", () => {
    expect(decode(encodeCursor(LookupKind.listings, option))).toEqual({
      sort: "name",
      label: option.label,
      id: option.id,
    });
  });

  it("does not spell the row out to whoever reads it", () => {
    const cursor = encodeCursor(LookupKind.listings, option);

    expect(cursor).not.toContain(option.id);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuses anything it did not write", () => {
    for (const value of [
      "",
      "not-a-cursor",
      raw("newest", label(option.label), option.id),
      raw("name", "", option.id),
      raw("name", "not base64!", option.id),
      raw("name", label(option.label), "not-a-uuid"),
      raw("name", label(option.label)),
    ]) {
      expect(decode(value)).toBeNull();
    }
  });

  /** An account is ordered by its name in two lookups; the tag keeps them apart. */
  it("refuses a cursor another lookup or list of this API issued", () => {
    expect(decode(encodeCursor(LookupKind.guests, option))).toBeNull();
    expect(
      decodeCursor(LookupKind.owners)(encodeCursor(LookupKind.guests, option)),
    ).toBeNull();
    expect(
      decode(encodeParts("listings", "name", label(option.label), option.id)),
    ).toBeNull();
  });

  /** Its key was an address, so the place it names is not one in an ordering by name. */
  it("refuses a cursor of the accounts issued while they were ordered by their address", () => {
    expect(
      decodeCursor(LookupKind.guests)(
        encodeParts(
          "lookup-guests",
          "name",
          label("guest@example.com"),
          option.id,
        ),
      ),
    ).toBeNull();
  });
});
