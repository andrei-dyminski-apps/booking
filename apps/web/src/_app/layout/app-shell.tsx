import { currentUser } from "#shared/api";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { SiteFooter } from "./site-footer";

/**
 * The frame every page is rendered inside, and the one place the shell asks who is
 * signed in. The sidebar, the sheet behind the menu button and the header all render
 * differently for a visitor with a session, and reading `/auth/me` in each of them would
 * be three round trips to the API for one answer — the transport gives up Next's
 * per-render memoization for its timeout (see `http-client.ts`), so nothing else would
 * collapse them. `currentUser` is memoized for the render on top of that, which is what
 * keeps the page under this shell from asking a fourth time.
 *
 * Reading the session here is also what opts the whole tree out of static rendering: the
 * shell differs per visitor, so no page above it can be a shared document. The catalogue
 * is the first screen that would rather be prerendered, and what it gets instead is a
 * cached read — the answer to `GET /listings` is shared between visitors in the Data
 * Cache even though the shell around it is rendered per request. Prerendering the shell
 * itself needs `cacheComponents`, a `<Suspense>` around this component, and a rewrite of
 * how `shared/api` says a read is cached — see `docs/plan.md`.
 */
export const AppShell = async ({ children }: { children: React.ReactNode }) => {
  const user = await currentUser();

  return (
    <div className="flex min-h-svh w-full">
      <Sidebar user={user} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} />

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 lg:py-10">
          {children}
        </main>

        <SiteFooter user={user} />
      </div>
    </div>
  );
};
