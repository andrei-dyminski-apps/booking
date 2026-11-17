import { Suspense } from "react";
import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { Skeleton } from "@repo/ui/components/skeleton";
import { ROUTES } from "#shared/config";
import { ButtonLink } from "#shared/ui";
import { AccountNotifications } from "./account-notifications";
import { MobileNav } from "./mobile-nav";
import { SessionRecovery } from "./session-recovery";
import { ThemeToggle } from "./theme-toggle";
import { TimeZoneCookie } from "./time-zone-cookie";
import { WithUser } from "./with-user";

/**
 * The bar above the page. Most of the navigation moved into the sidebar beside it, so
 * what is left here is what belongs to the window rather than to the site: the way to
 * open that navigation on a narrow screen, the theme, the two calls to action a
 * stranger has, and the notification bell of somebody who is not one.
 *
 * What names the visitor — the menu, the calls to action or the bell — is read in two
 * islands (`WithUser`), so the bar itself is part of the prerendered shell and the session
 * is streamed into it. `null` there means "no live access token", which is not the same as signed out,
 * hence `SessionRecovery` beside it: the one thing about a session that only the browser
 * can settle. `TimeZoneCookie` is the other thing only the browser knows: its own clock.
 */
export const Header = () => (
  <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
    <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
      <div className="lg:hidden">
        <Suspense fallback={<Skeleton className="size-8 rounded-lg" />}>
          <WithUser>{(user) => <MobileNav user={user} />}</WithUser>
        </Suspense>
      </div>

      <Link
        href={ROUTES.home}
        className="font-semibold tracking-tight lg:hidden"
      >
        Booking
      </Link>

      <div className="ml-auto flex items-center gap-2">
        {/*
          The catalogue is offered to everybody, signed in or not: the three reading routes
          behind it are `@Public()` for the same reason — a catalogue nobody may see
          before signing up is not a catalogue.
        */}
        <ButtonLink href={ROUTES.catalogue} variant="ghost" size="sm">
          <SearchIcon />
          <span className="sr-only sm:not-sr-only">Find a stay</span>
        </ButtonLink>

        <Suspense fallback={<Skeleton className="h-7 w-16 rounded-lg" />}>
          <WithUser>
            {(user) => (
              <>
                <SessionRecovery signedIn={user !== null} />
                <TimeZoneCookie signedIn={user !== null} />

                {user === null ? (
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
                ) : (
                  // Only for a session: the stream behind both is the account's own.
                  <AccountNotifications />
                )}
              </>
            )}
          </WithUser>
        </Suspense>

        <ThemeToggle />
      </div>
    </div>
  </header>
);
