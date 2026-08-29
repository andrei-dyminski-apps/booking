import { z } from "zod";
import { listingSchema, listingSortSchema } from "@repo/contracts";
import type { Listing, ListingSort } from "@repo/contracts";

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
 * a cursor handed back with a different `sort` — see `ListingService.readCursor`. Changing
 * what the catalogue is ordered by starts the list again, and answering the request as if
 * it had not would silently return a page of a list nobody asked for.
 *
 * The row it names does not have to exist any more, and that is the reason the comparison
 * is written out in `ListingRepository` rather than handed to Prisma's own `cursor`: a
 * listing retired between two pages would take the cursor with it and end the list early.
 */
export type CatalogueCursor =
  | { sort: "newest" | "oldest"; createdAt: Date; id: string }
  | { sort: "priceAsc" | "priceDesc"; pricePerNight: number; id: string };

/**
 * Opaque to the client on purpose. What it encodes is how the catalogue is cut into pages,
 * and that is the server's to change — a base64 string is a value to hand back, while
 * `created_at,id` in plain sight is an invitation to construct one.
 */
export function encodeCursor(listing: Listing, sort: ListingSort): string {
  const parts = [sort, sortKey(listing, sort), listing.id];

  return Buffer.from(parts.join(SEPARATOR), "utf8").toString("base64url");
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
  const parts = Buffer.from(raw, "base64url").toString("utf8").split(SEPARATOR);

  if (parts.length !== 3) return null;

  const parsed = cursorSchema.safeParse({
    sort: parts[0],
    key: parts[1],
    id: parts[2],
  });

  if (!parsed.success) return null;

  const { sort, key, id } = parsed.data;

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

/** A colon or a comma would need escaping; no half of the triple can contain this one. */
const SEPARATOR = "|";

/**
 * The one spelling `encodeCursor` writes for a price, and therefore the only one read back:
 * the amount to exactly two decimals, the scale the column stores and the contract refuses
 * to go finer than. `z.coerce.number()` in its place would also take `1e4`, ` 120.00 `,
 * `120.000` and `0x78` — every one of them a value this API never issued, and the branch
 * above it refuses a timestamp that is off by a character. A cursor is untrusted input, so
 * the two keys are read to the same standard rather than one of them being read leniently.
 */
const CENTS = z.string().regex(/^\d+\.\d{2}$/);

const cursorSchema = z.object({
  sort: listingSortSchema,
  key: z.string().min(1),
  id: listingSchema.shape.id,
});
