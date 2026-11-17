import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { SiteFooter } from "./site-footer";

/**
 * The frame every page is rendered inside. The sidebar, the sheet behind the menu button,
 * the header and the footer all render differently for a visitor with a session, so each
 * reads it in an island of its own (`WithUser`, under a `<Suspense>` drawn as a
 * placeholder of the same size) rather than this component reading it for the whole
 * frame. Reading it here would make the frame, and every page inside it, wait for
 * `/auth/me` on every request; read in the islands, the frame and the page are the
 * prerendered shell and only the parts that name the visitor are streamed.
 */
export const AppShell = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-svh w-full">
    <Sidebar />

    <div className="flex min-w-0 flex-1 flex-col">
      <Header />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 lg:py-10">
        {children}
      </main>

      <SiteFooter />
    </div>
  </div>
);
