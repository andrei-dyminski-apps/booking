/**
 * A Next.js `searchParams` object rendered back into a URL under `base`, exactly as it
 * arrived: every value kept, a repeated parameter left repeated, nothing sorted and
 * nothing dropped.
 *
 * It is here so a slice can compare the address it was handed against the canonical one it
 * would have written for the same filters. `searchParams` reaches a page already decoded,
 * so both sides pass through `URLSearchParams` and the spelling of a space — and of every
 * other escaped character — settles before the comparison rather than turning into a
 * difference. This is the domain-free half of that job; which parameters are filters, and
 * how a canonical link spells them, stays in the slice.
 */
export function searchParamsHref(
  base: string,
  params: Record<string, string | string[] | undefined>,
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") search.append(key, value);
    else if (Array.isArray(value))
      for (const one of value) search.append(key, one);
  }

  const query = search.toString();

  return query === "" ? base : `${base}?${query}`;
}

/**
 * One value for a search parameter, or none. A parameter repeated in the URL arrives as an
 * array, and this application never writes one — so rather than guessing which of them was
 * meant, it is dropped and the caller is left with the empty string it reads as absence.
 * Surrounding space is trimmed: it is what a stray paste into the address bar leaves, and
 * no filter here is meant to carry it.
 */
export function singleParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A link to `base` carrying the filter values that are set, and the cursor of the next
 * page when one is handed over.
 *
 * The domain-free half of a slice's `catalogueHref` / `bookingsHref`: which keys `values`
 * has, in which order, and what a canonical link of that list looks like stays in the
 * slice — this drops the blanks (a schema reads a blank box as absence anyway), keeps the
 * order it was given, and appends the cursor last. The cursor is a separate argument on
 * purpose: it names a place in one ordering, so a link a slice writes for a changed filter
 * or ordering leaves it out.
 */
export function filtersHref(
  base: string,
  values: Record<string, string>,
  cursor?: string,
): string {
  const search = new URLSearchParams(withoutEmpty(values));

  if (cursor !== undefined) search.set("cursor", cursor);

  const query = search.toString();

  return query === "" ? base : `${base}?${query}`;
}

/** The entries whose value is a non-empty string — a blank box is not a filter. */
function withoutEmpty(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== ""),
  );
}
