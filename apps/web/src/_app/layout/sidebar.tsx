import { Suspense } from "react";
import Link from "next/link";
import { BuildingIcon } from "lucide-react";
import { Skeleton } from "@repo/ui/components/skeleton";
import { ROUTES } from "#shared/config";
import { AccountPanel } from "./account-panel";
import { NavLinks } from "./nav-links";
import { WithUser } from "./with-user";

/**
 * The navigation of the site as a column beside the page rather than a row above it. It
 * appears from `lg` up and is replaced by the sheet behind the header's menu button below
 * that — the same list either way (`navigation.ts`), because two lists would be two role
 * rules to keep in step.
 *
 * The logo is the same for everybody and is part of the prerendered shell; the links and
 * the account panel name the visitor, so they are one island (`WithUser`) drawn as bars of
 * their size until the session arrives.
 */
export const Sidebar = () => (
  <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col gap-6 border-r border-border bg-sidebar px-3 py-4 lg:flex">
    <Link
      href={ROUTES.home}
      className="flex items-center gap-2 rounded-lg px-2 py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span
        aria-hidden
        className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"
      >
        <BuildingIcon className="size-4" />
      </span>
      <span className="font-semibold tracking-tight">Booking</span>
    </Link>

    <Suspense fallback={<SidebarSkeleton />}>
      <WithUser>
        {(user) => (
          <>
            <NavLinks user={user} className="flex-1" />
            <AccountPanel user={user} />
          </>
        )}
      </WithUser>
    </Suspense>
  </aside>
);

/** A row per link a stranger is offered, and the two buttons of the panel under them. */
const SidebarSkeleton = () => (
  <>
    <div className="flex flex-1 flex-col gap-1">
      {[0, 1].map((row) => (
        <Skeleton key={row} className="h-12 rounded-lg" />
      ))}
    </div>
    <div className="flex flex-col gap-2">
      <Skeleton className="h-8 rounded-lg" />
      <Skeleton className="h-8 rounded-lg" />
    </div>
  </>
);
