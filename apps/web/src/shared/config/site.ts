/** What the site calls itself: the tab's title, the shared link's name and the publisher's. */
export const SITE_NAME = "StayDesk";

/** What the site says it is: the description a result shows and the shared link carries. */
export const SITE_DESCRIPTION =
  "Find a stay, book the nights and pay for them; hosts list rooms and get paid out. A demo built on one shared zod contract.";

/**
 * The square logo a document names the site by — the `Organization` of the JSON-LD and the
 * web app manifest. A file of `public/`, not one of the `app/icon` conventions, whose
 * address Next suffixes with a hash a document could not state ahead of time.
 */
export const SITE_LOGO = "/icon-512.png";

/** Where the source lives: the home page links to it and to the sections of its README. */
export const REPOSITORY_URL = "https://github.com/andrei-dyminski-apps/booking";

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
    normalizeWebOrigin(process.env.SITE_ORIGIN) ??
    normalizeWebOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    `http://localhost:${process.env.WEB_PORT || "3000"}`
  );
}

/** A path of this site as the absolute URL a document states it by. */
export function siteUrl(path: string): string {
  return `${siteOrigin()}${path}`;
}

import { normalizeWebOrigin } from "@repo/contracts";
