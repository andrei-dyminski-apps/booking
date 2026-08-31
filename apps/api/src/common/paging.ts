import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

/**
 * What every keyset-paged read of this API shares: the shape a repository answers with,
 * the envelope its cursor is written in, and the two refusals a cursor arrives with. The
 * catalogue and the stays are the two so far, and the second one is what moved this out of
 * either of them — a cursor written `sort|key|id` in one file and `key|id|sort` in the
 * other is a difference nothing would report until a page came back empty.
 *
 * What stays with each resource is the half that knows the domain: which columns the
 * orderings are made of, and how the key of each one is read back. See
 * `listing/catalogue-cursor.ts` and `booking/booking-cursor.ts`.
 */

/**
 * One page as a repository answers it: the rows asked for, and whether there is another
 * page after them. `hasMore` rather than a total — the count would be a second query over
 * the same rows, and nothing here counts pages: a keyset list is asked forwards, one
 * cursor at a time. It is what the service turns into the `nextCursor` of the contract.
 */
export type Page<Row> = { items: Row[]; hasMore: boolean };

/** The parts of a cursor, once the envelope is off and before the key is read. */
export type CursorParts<Sort extends string> = {
  sort: Sort;
  key: string;
  id: string;
};

/** A colon or a comma would need escaping; no part of a cursor can contain this one. */
const SEPARATOR = "|";

/**
 * A cursor as it travels: opaque to the client on purpose, because what it encodes is how
 * a list is cut into pages and that is the server's to change — a base64 string is a value
 * to hand back, while `created_at,id` in plain sight is an invitation to construct one.
 *
 * The resource is the first part and not a formality. Every list here spells its cursor
 * the same way, so without it a `newest` cursor of the catalogue would decode as a
 * perfectly valid `newest` cursor of the stays — a timestamp and a uuid are a timestamp
 * and a uuid — and the answer would be a page of a question nobody asked instead of the
 * `400` a cursor from somewhere else deserves. It leaks nothing: the client already knows
 * which list it asked.
 */
export function encodeParts(
  resource: string,
  sort: string,
  key: string,
  id: string,
): string {
  return Buffer.from(
    [resource, sort, key, id].join(SEPARATOR),
    "utf8",
  ).toString("base64url");
}

/**
 * `null` for anything this cannot read — the value arrives in a URL, so it is untrusted
 * input like any other, and every part of it is validated as strictly as the schema
 * validates a field. The caller answers that with a `400` through `readCursor` below.
 *
 * The `sort` and the `id` are read here because every list of this API says them the same
 * way, and each against the schema the resource hands in rather than against a rule
 * restated here. The `key` is passed back as text: what values it may take is the one
 * thing only the resource knows, and reading it leniently is how a cursor comes to name a
 * place no row could hold.
 */
export function decodeParts<Sort extends string>(
  resource: string,
  raw: string,
  schemas: { sort: z.ZodType<Sort>; id: z.ZodType<string> },
): CursorParts<Sort> | null {
  const parts = Buffer.from(raw, "base64url").toString("utf8").split(SEPARATOR);

  if (parts.length !== 4 || parts[0] !== resource) return null;

  const sort = schemas.sort.safeParse(parts[1]);
  const id = schemas.id.safeParse(parts[3]);
  const key = parts[2];

  if (!sort.success || !id.success || key === undefined || key === "") {
    return null;
  }

  return { sort: sort.data, key, id: id.data };
}

/**
 * The two mistakes a keyset cursor can arrive with, answered the same way for every list
 * that issues one. Both reads that page — the catalogue and the stays — decode a value of
 * their own and then ask exactly this, so the words a client is refused with are written
 * once rather than twice.
 *
 * No cursor is the first page; one this API cannot read is a `400`. A `decode` returns
 * `null` for an absent and for an unreadable value alike, so the two are told apart here,
 * where only one of them is a mistake.
 *
 * A cursor issued under another ordering is the second mistake, and it is a `400` rather
 * than a first page for the same reason: it names a place in a list this request is not
 * asking for, and the rows after it are a page of neither. It is said in its own words
 * because a client can act on it — changing the ordering means starting the pages again,
 * which is exactly what dropping the cursor does.
 */
export function readCursor<Sort extends string, Cursor extends { sort: Sort }>(
  raw: string | undefined,
  sort: Sort,
  decode: (raw: string) => Cursor | null,
): Cursor | null {
  if (raw === undefined) return null;

  const cursor = decode(raw);

  if (cursor === null) {
    throw new BadRequestException("Malformed cursor");
  }

  if (cursor.sort !== sort) {
    throw new BadRequestException(
      "This cursor was issued for a different ordering",
    );
  }

  return cursor;
}
