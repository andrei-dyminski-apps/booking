/** What the site calls itself: the tab's title, the shared link's name and the publisher's. */
export const SITE_NAME = "Booking";

/**
 * A configured address as an origin, or `null` when it cannot be one. A bare host is read
 * as `https` — Vercel's variable never carries a scheme, and somebody filling in
 * `SITE_ORIGIN` by hand may leave it off too — and anything past the host is dropped,
 * a trailing slash included, which would double up in front of every path.
 */
function originOf(value: string | undefined): string | null {
  if (!value) return null;

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;

  if (!URL.canParse(withScheme)) return null;

  const url = new URL(withScheme);

  return url.protocol === "https:" || url.protocol === "http:"
    ? url.origin
    : null;
}

/**
 * The public address of this site, which every absolute URL it states about itself is
 * built on: the canonical link, the shared link's `og:url`, every `url` and `@id` of the
 * JSON-LD. A crawler reads those as the address the page belongs at, so they are an
 * address of the deployment people are sent to, not of the host that answered — a
 * preview's throwaway hostname names its pages as production's.
 *
 * Read on the server and on demand, like `API_ORIGIN`, in this order:
 *
 * - `SITE_ORIGIN`, for a deployment that is not Vercel or a domain Vercel would not pick;
 * - `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets on every deployment, previews
 *   included, to the production domain without a scheme — so a deployment there needs
 *   nothing set by hand;
 * - this machine's own port, for `pnpm dev` and `next start` on it.
 *
 * A fallback rather than a failure, unlike `API_ORIGIN`: an address a page states about
 * itself is no reason not to render it. A value that is not an address is passed over
 * like an empty one — the root layout's `metadataBase` is built on this on every request,
 * and a `new URL` that throws there would take every page down with it.
 */
export function siteOrigin(): string {
  return (
    originOf(process.env.SITE_ORIGIN) ??
    originOf(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    `http://localhost:${process.env.WEB_PORT || "3000"}`
  );
}

/** A path of this site as the absolute URL a document states it by. */
export function siteUrl(path: string): string {
  return `${siteOrigin()}${path}`;
}
