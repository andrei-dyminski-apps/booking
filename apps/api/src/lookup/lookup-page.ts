import {
  lookupOptionSchema,
  type LookupOption,
  type LookupQuery,
} from "@repo/contracts";
import type { Page } from "../common/paging";
import type { Prisma } from "../generated/prisma/client";
import type { LookupCursor } from "./lookup-cursor";

/**
 * One model's `where` spelled from the column a lookup names its rows by and the id —
 * `(name, id) => ({ email: name, id })`. An `undefined` is how Prisma spells "no
 * condition", so one callback covers the search, the whole id and both halves of the
 * cursor.
 */
type NameAndId<Where> = (
  name: Prisma.StringFilter | undefined,
  id?: Prisma.UuidFilter,
) => Where;

/**
 * What every lookup adds to its scope: the search — `contains`, which the caller spells
 * because an address and a title are matched differently — or the whole id `q` names, and
 * the keyset after the cursor. The cursor says the name twice for the reason `afterCursor`
 * gives in `listing.repository.ts`: `>=` is the half an index can start from. The result
 * goes into an `AND` beside the scope, never spread into it, so the search cannot replace
 * a condition of the scope on the same column.
 */
export function lookupConditions<Where>(
  where: NameAndId<Where>,
  contains: Prisma.StringFilter,
  query: LookupQuery,
  cursor: LookupCursor | null,
): Array<Where | { OR: Where[] }> {
  const id = idIn(query.q);

  return [
    id === null ? where(contains) : where(undefined, { equals: id }),
    ...(cursor === null
      ? []
      : [
          where({ gte: cursor.label }),
          {
            OR: [
              where({ gt: cursor.label }),
              where({ equals: cursor.label }, { gt: cursor.id }),
            ],
          },
        ]),
  ];
}

/**
 * The `limit + 1` rows a lookup read, as a page: the extra row only says there is another
 * one, so the caller learns that without a second `count`.
 */
export function toLookupPage<Row>(
  rows: Row[],
  limit: number,
  toOption: (row: Row) => LookupOption,
): Page<LookupOption> {
  return {
    items: rows.slice(0, limit).map(toOption),
    hasMore: rows.length > limit,
  };
}

/**
 * The id a search names, when it is one — matched whole and never as a part, for the
 * reason `lookupQuerySchema` states. Read with the contract's own rule for an id, so what
 * counts as "a uuid" here is what the filter it fills in will accept.
 */
function idIn(q: string): string | null {
  const id = lookupOptionSchema.shape.id.safeParse(q);

  return id.success ? id.data : null;
}
