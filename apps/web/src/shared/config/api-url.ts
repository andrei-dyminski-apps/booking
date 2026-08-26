/**
 * Where each side of this application finds the API.
 *
 * The browser no longer talks to Nest at all: it calls this origin under `BFF_BASE_PATH`,
 * and the route handler behind that path forwards the request. That is what turns the
 * session into a first-party cookie — to the browser the frontend and the API are one
 * site, so there is no `SameSite=None` to weaken, no CORS preflight to configure, and a
 * preview deployment on a throwaway hostname keeps its session instead of losing it.
 *
 * A server render has none of those problems and takes the short path: it calls Nest
 * directly, because routing its own request back through its own route handler would buy
 * nothing but a second hop.
 */

/** The prefix of the proxy in `app/api/[...path]/route.ts`; a browser request wears it. */
export const BFF_BASE_PATH = "/api";

let origin: string | undefined;

/**
 * Read on the server, and on demand — unlike the `NEXT_PUBLIC_API_URL` this replaces.
 * The address never reaches the browser any more, so it is no longer inlined at
 * `next build` and no longer belongs to the environment of the build: changing it is a
 * restart rather than a rebuild, and a pipeline that passes it only to the running
 * container is now right instead of broken.
 *
 * There is still no fallback. A missing value has to fail the request with its own name
 * in the message rather than quietly walk to the developer's machine.
 */
export function apiOrigin(): string {
  if (origin !== undefined) return origin;

  const value = process.env.API_ORIGIN;

  if (!value) {
    throw new Error(
      "API_ORIGIN is not set. Copy .env.example to .env in the repository root.",
    );
  }

  // A trailing slash would turn every request path into a double slash.
  origin = value.replace(/\/+$/, "");

  return origin;
}
