import { z } from "zod";
import { stayPartySchema } from "./booking.js";
import { blank, PAGING } from "./query.js";

/**
 * The shortest search a lookup answers. Fewer characters match too much of a table to be a
 * question anybody is asking, and three is exactly one trigram — the unit of the index
 * both searchable columns carry, so a search below it could not use the index at all.
 */
export const LOOKUP_MIN_LENGTH = 3;

/**
 * What a filter box asks while somebody types into it: the rows of one kind whose name
 * contains `q`, regardless of case, or the one row whose id `q` is. An admin's lookup of
 * accounts matches the address as well — see `hint` below for why only theirs.
 *
 * **An id is matched whole or not at all.** A uuid is not something a person remembers a
 * part of — it is pasted from an address — so a `q` that parses as one is an exact match on
 * the id, and anything else is a search of the name. Part of a uuid would match names and
 * ids alike, and nobody reads a list of rows that share four hex digits with what they
 * typed.
 *
 * Paged like every other list here, because the answer has no ceiling: three letters of a
 * name can be half of the site's accounts. The box asks for the next page as the list is
 * scrolled to its end, with the `nextCursor` of the one before.
 *
 * `side` is the one `GET /bookings` takes, so the box beside a list of stays offers what
 * that list can match: the listings of an account's trips, or of the stays against its
 * own. Only the lookup of listings has two sides to pick from — the guests of an account
 * are always the guests of its listings, and the owners are an admin's — so the others
 * ignore it, as an admin's scope does.
 */
export const lookupQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(LOOKUP_MIN_LENGTH, {
      error: `Type at least ${LOOKUP_MIN_LENGTH} characters`,
    })
    .max(254, { error: "A search is never longer than 254 characters" }),
  side: blank(stayPartySchema.default("GUEST")),
  ...PAGING,
});

/**
 * One row as a filter box offers it: the id that goes into the URL, the name a person picks
 * it by — an account's name, a listing's title — and, where the caller may read one, a
 * second line that tells two rows of the same name apart.
 *
 * `hint` is an account's address, and only an admin is handed it: a name is not unique,
 * and the address is what an admin already sees on every account. A host is not — the
 * address of somebody who stayed with them is not theirs to read, which is why the lookup
 * of their guests matches the name alone and answers `null` here. A listing has no hint:
 * its title is what everybody reads.
 */
export const lookupOptionSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  hint: z.string().nullable(),
});

/**
 * One page of matches, in the order of their names. `nextCursor` is `null` on the last
 * page, exactly as on every other list of this API.
 */
export const lookupPageSchema = z.object({
  items: z.array(lookupOptionSchema),
  nextCursor: z.string().nullable(),
});

/**
 * What a filter box can look up, one value per route of `/lookups`. Each answers with the
 * rows its filter can actually match for the caller — the owners of what is on offer, the
 * guests and the listings of the stays the caller may read — so a suggestion is never a
 * filter that empties the list by construction.
 */
export const lookupKindSchema = z.enum(["owners", "guests", "listings"]);

export const LookupKind = lookupKindSchema.enum;

export type LookupQuery = z.infer<typeof lookupQuerySchema>;
export type LookupOption = z.infer<typeof lookupOptionSchema>;
export type LookupPage = z.infer<typeof lookupPageSchema>;
export type LookupKind = z.infer<typeof lookupKindSchema>;
