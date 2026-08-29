import Link from "next/link";
import type { User } from "@repo/contracts";
import { ROUTES } from "#shared/config";

/**
 * The quiet end of every page: what this is, and the links a visitor might want from it.
 *
 * It is handed the session for the same reason the sidebar is, and it offers the same
 * thing the sidebar offers: the catalogue to everybody, the stays only to somebody who
 * has any. `navigationFor` already drops that link for a stranger, and a footer that
 * kept it would send them to a `/login?next=/bookings` they never asked for — the two
 * halves of the shell would then disagree about the same section.
 */
export const SiteFooter = ({ user }: { user: User | null }) => (
  <footer className="border-t border-border">
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <p>Booking — a demo built on one shared zod contract.</p>
      <nav className="flex items-center gap-4">
        <Link href={ROUTES.catalogue} className="hover:text-foreground">
          Stays
        </Link>
        {user === null ? (
          <Link href={ROUTES.login} className="hover:text-foreground">
            Sign in
          </Link>
        ) : (
          <Link href={ROUTES.bookings} className="hover:text-foreground">
            Bookings
          </Link>
        )}
      </nav>
    </div>
  </footer>
);
