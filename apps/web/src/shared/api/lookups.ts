import {
  lookupOptionSchema,
  lookupPageSchema,
  type LookupKind,
  type LookupPage,
  type LookupQuery,
} from "@repo/contracts";
import { apiRequest, queryString } from "./http-client";

/**
 * What a filter box that takes an id suggests while somebody types into it — one route per
 * kind of row, each answering with the rows its filter can match for this session. Who may
 * ask which is the API's to decide, and nothing here repeats it.
 *
 * Mostly a browser call, unlike every other read of this segment: it runs on each keystroke
 * of a box that is already on the screen. The one server read is `nameOf`, a page naming
 * the row its URL filters by — once per render rather than once per opening of the dialog
 * the box sits in. `no-store` because the answer is scoped to the session, and the
 * `signal` because a keystroke makes the request for the one before it worthless.
 */
const page = (
  kind: LookupKind,
  query: LookupQuery,
  signal?: AbortSignal,
): Promise<LookupPage> =>
  apiRequest({
    method: "GET",
    path: `/lookups/${kind}${queryString(query)}`,
    schema: lookupPageSchema,
    read: { cache: "no-store" },
    signal,
  });

export const lookupsApi = {
  page,
  /**
   * The name of the row an id names, by the same lookup the box uses: the id is matched
   * whole, so the answer is that row or nothing. `undefined` for anything else — not an id,
   * nobody this session may look up, an API that did not answer — because a name is only
   * what a chip and a box read instead of the id, and the id is still the filter.
   */
  nameOf: async (kind: LookupKind, id: string): Promise<string | undefined> => {
    if (!lookupOptionSchema.shape.id.safeParse(id).success) return undefined;

    try {
      const {
        items: [found],
      } = await page(kind, { q: id, limit: 1 });

      return found?.label;
    } catch {
      return undefined;
    }
  },
};
