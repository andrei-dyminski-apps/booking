import {
  lookupOptionSchema,
  type LookupKind,
  type LookupOption,
} from "@repo/contracts";
import { z } from "zod";
import { decodeParts, encodeParts } from "../common/paging";

/**
 * The one ordering a lookup has: by the name a person picks a row by, with the id behind
 * it. A box that suggests is read top-down like a dictionary, so there is nothing for a
 * client to choose — the `sort` is still carried, because the envelope every cursor here
 * shares has a place for it and `readCursor` compares it.
 */
export const LOOKUP_SORT = "name";

const lookupSortSchema = z.literal(LOOKUP_SORT);

/** The place a page of matches ends: the name of its last row and that row's id. */
export type LookupCursor = {
  sort: typeof LOOKUP_SORT;
  label: string;
  id: string;
};

/**
 * One tag per kind: an account is ordered by its address in two lookups, and without the
 * tag a cursor of the guests would read as a good place among the owners.
 */
const resource = (kind: LookupKind): string => `lookup-${kind}`;

/**
 * The name is base64url-encoded inside the envelope, unlike the key of any other cursor. A
 * timestamp or a price cannot contain the separator the envelope splits on; a title can,
 * and one with a `|` in it would decode as a cursor with five parts.
 */
export function encodeCursor(kind: LookupKind, option: LookupOption): string {
  return encodeParts(
    resource(kind),
    LOOKUP_SORT,
    Buffer.from(option.label, "utf8").toString("base64url"),
    option.id,
  );
}

/**
 * `null` for anything this cannot read, which the caller answers with a `400`. Node decodes
 * base64url leniently — it skips what is not in the alphabet — so the key is accepted only
 * if it re-encodes to itself, which is what makes it a value this API wrote.
 */
export function decodeCursor(
  kind: LookupKind,
): (raw: string) => LookupCursor | null {
  return (raw) => {
    const parts = decodeParts(resource(kind), raw, {
      sort: lookupSortSchema,
      id: lookupOptionSchema.shape.id,
    });

    if (parts === null) return null;

    const label = Buffer.from(parts.key, "base64url").toString("utf8");

    return Buffer.from(label, "utf8").toString("base64url") === parts.key
      ? { sort: parts.sort, label, id: parts.id }
      : null;
  };
}
