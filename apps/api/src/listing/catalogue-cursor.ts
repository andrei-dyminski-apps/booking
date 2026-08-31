import { z } from "zod";
import { listingSchema, listingSortSchema } from "@repo/contracts";
import type { Listing, ListingSort } from "@repo/contracts";
import { decodeParts, encodeParts } from "../common/paging";

/**
 * The place in the catalogue a page ends, as the client hands it back. Keyset rather than
 * an offset: the catalogue is ordered by a column somebody else keeps writing to, and a
 * listing published while somebody is paging would shift every offset after it, showing
 * one row twice and skipping another. A cursor names the row instead, so the page after it
 * is the same page whatever was written in the meantime.
 *
 * The pair it carries is the pair the ordering is made of — the sort key and `id`, the
 * tiebreaker for two rows level on that key. A cursor that carried only the key would
 * either repeat those two or drop them.
 *
 * The sort is in it as well, and it is what makes the pair readable: `120.00` is a price
 * under one ordering and nothing at all under another. It is also what lets the API refuse
 * a cursor handed back with a different `sort` — see `readCursor` in `src/common/paging.ts`.
 * Changing what the catalogue is ordered by starts the list again, and answering the
 * request as if it had not would silently return a page of a list nobody asked for.
 *
 * The row it names does not have to exist any more, and that is the reason the comparison
 * is written out in `ListingRepository` rather than handed to Prisma's own `cursor`: a
 * listing retired between two pages would take the cursor with it and end the list early.
 */
export type CatalogueCursor =
  | { sort: "newest" | "oldest"; createdAt: Date; id: string }
  | { sort: "priceAsc" | "priceDesc"; pricePerNight: number; id: string };

/**
 * The envelope — the base64 spelling, the separator and the resource tag — belongs to
 * `src/common/paging.ts`, because every paged read of this API writes a cursor the same
 * way. What is left here is the half only the catalogue knows: which column each ordering
 * sorts by, and how that column's value is read back.
 */
const RESOURCE = "listings";

export function encodeCursor(listing: Listing, sort: ListingSort): string {
  return encodeParts(RESOURCE, sort, sortKey(listing, sort), listing.id);
}

/**
 * `null` for anything this cannot read — the value arrives in a URL, so it is untrusted
 * input like any other, and every half of it is validated as strictly as the schema
 * validates a field. The caller answers that with a `400`: a cursor is either one this API
 * issued or a mistake, and silently starting from the top would answer a different
 * question than the one asked.
 *
 * The key is read against the rule the contract already writes for the column it comes
 * from, so a cursor cannot name a price no listing could have.
 */
export function decodeCursor(raw: string): CatalogueCursor | null {
  const parts = decodeParts(RESOURCE, raw, {
    sort: listingSortSchema,
    id: listingSchema.shape.id,
  });

  if (parts === null) return null;

  const { sort, key, id } = parts;

  switch (sort) {
    case "newest":
    case "oldest": {
      const createdAt = listingSchema.shape.createdAt.safeParse(key);

      return createdAt.success
        ? { sort, createdAt: new Date(createdAt.data), id }
        : null;
    }
    case "priceAsc":
    case "priceDesc": {
      const price = CENTS.transform(Number)
        .pipe(listingSchema.shape.pricePerNight)
        .safeParse(key);

      return price.success ? { sort, pricePerNight: price.data, id } : null;
    }
  }
}

/**
 * The value of the column this ordering sorts by, as text. The switch is exhaustive on
 * purpose: a fifth sort added to the contract stops compiling here and in `afterCursor`,
 * which is where the other half of the same decision lives.
 */
function sortKey(listing: Listing, sort: ListingSort): string {
  switch (sort) {
    case "newest":
    case "oldest":
      return listing.createdAt;
    case "priceAsc":
    case "priceDesc":
      // `toFixed(2)` rather than `String`, so that one price has one spelling: 120 and
      // 120.5 are the same amount as 120.00 and 120.50, and a cursor that could be written
      // three ways is a cursor `CENTS` would have to read three ways.
      return listing.pricePerNight.toFixed(2);
  }
}

/**
 * The one spelling `encodeCursor` writes for a price, and therefore the only one read back:
 * the amount to exactly two decimals, the scale the column stores and the contract refuses
 * to go finer than. `z.coerce.number()` in its place would also take `1e4`, ` 120.00 `,
 * `120.000` and `0x78` — every one of them a value this API never issued, and the branch
 * above it refuses a timestamp that is off by a character. A cursor is untrusted input, so
 * the two keys are read to the same standard rather than one of them being read leniently.
 */
const CENTS = z.string().regex(/^\d+\.\d{2}$/);
