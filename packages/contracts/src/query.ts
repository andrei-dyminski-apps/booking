import { z } from "zod";

/**
 * What both of this API's listing reads have in common: they arrive in a query string, so
 * every value is text until it is coerced, and both are cut into keyset pages.
 *
 * The rules live here rather than in one of the two resources because they are rules about
 * a URL, not about a stay or a listing — and the second resource to need them is the point
 * at which restating them would have been the mistake: a `limit` capped at 50 in one file
 * and at 100 in the other is a difference nothing would report.
 */

/**
 * A filter nobody filled in, as a URL spells it. An empty input serialises to `?guests=`
 * rather than to nothing at all, and every coercion below it would read that differently:
 * `Number("")` is `0`, so a numeric filter would quietly become one while a date, a uuid
 * and a cursor each answered `400`. The blank is turned into the absence it means before
 * any of them sees it, so one form with three empty fields asks the same question as a
 * form with none.
 */
export const blank = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

/** How many rows one page may carry, and the one parameter a client could ask the whole table with. */
const MAX_LIMIT = 50;

const DEFAULT_LIMIT = 20;

/**
 * The two parameters that cut a list into pages, spread into the query schema of each
 * resource that has one.
 *
 * `cursor` is opaque on purpose — it is issued by the `nextCursor` of the previous page
 * and decoded only by the API, so how the pages are cut stays the server's to change. It
 * names a place in one ordering, which is why every resource that issues one carries the
 * `sort` inside it and refuses the cursor against another ordering: a page is only the
 * next one of the same list.
 */
export const PAGING = {
  cursor: blank(z.string().min(1).optional()),
  limit: blank(
    z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  ),
};
