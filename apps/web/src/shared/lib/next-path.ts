/**
 * Where to go after signing in. The value arrives in a query parameter, which means it
 * arrives from whoever wrote the link — so only a path of this site is accepted: `//evil`
 * and `/\evil` are absolute URLs to a browser, and following one would turn the login
 * page into an open redirect that borrows this site's name.
 *
 * A repeated `?next=` yields an array and is refused for the same reason: nothing here
 * writes such a link.
 */
export function toLocalPath(
  value: string | string[] | undefined,
  fallback: string,
): string {
  if (typeof value !== "string") return fallback;

  return /^\/(?![/\\])/.test(value) ? value : fallback;
}
