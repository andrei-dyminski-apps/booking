import Link from "next/link";
import { SearchIcon } from "lucide-react";
import type { User } from "@repo/contracts";
import { ROUTES } from "#shared/config";
import { ButtonLink } from "#shared/ui";
import { MobileNav } from "./mobile-nav";
import { NotificationBell } from "./notification-bell";
import { SessionRecovery } from "./session-recovery";
import { ThemeToggle } from "./theme-toggle";

/**
 * The bar above the page. Most of the navigation moved into the sidebar beside it, so
 * what is left here is what belongs to the window rather than to the site: the way to
 * open that navigation on a narrow screen, the theme, the two calls to action a
 * stranger has, and the notification bell of somebody who is not one.
 *
 * It is handed the session instead of reading one — `AppShell` asks once for the whole
 * shell. `null` there means "no live access token", which is not the same as signed out,
 * hence `SessionRecovery` beside it: the one thing about a session that only the browser
 * can settle.
 */
export const Header = ({ user }: { user: User | null }) => (
  <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
    <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
      <div className="lg:hidden">
        <MobileNav user={user} />
      </div>

      <Link
        href={ROUTES.home}
        className="font-semibold tracking-tight lg:hidden"
      >
        Booking
      </Link>

      <SessionRecovery signedIn={user !== null} />

      <div className="ml-auto flex items-center gap-2">
        {/*
          The catalogue is offered to everybody, signed in or not: the three reading routes
          behind it are `@Public()` for the same reason — a catalogue nobody may see
          before signing up is not a catalogue.
        */}
        <ButtonLink href={ROUTES.catalogue} variant="ghost" size="sm">
          <SearchIcon />
          <span className="hidden sm:inline">Find a stay</span>
        </ButtonLink>

        {user === null && (
          <>
            <ButtonLink
              href={ROUTES.login}
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
            >
              Sign in
            </ButtonLink>
            <ButtonLink href={ROUTES.register} size="sm">
              Sign up
            </ButtonLink>
          </>
        )}

        {/* Only for a session: the stream behind it is the account's own. */}
        {user !== null && <NotificationBell />}

        <ThemeToggle />
      </div>
    </div>
  </header>
);
