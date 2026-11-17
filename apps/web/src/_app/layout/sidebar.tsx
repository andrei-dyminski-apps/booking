import Link from "next/link";
import { BuildingIcon } from "lucide-react";
import type { User } from "@repo/contracts";
import { ROUTES } from "#shared/config";
import { AccountPanel } from "./account-panel";
import { NavLinks } from "./nav-links";

/**
 * The navigation of the site as a column beside the page rather than a row above it. It
 * appears from `lg` up and is replaced by the sheet behind the header's menu button below
 * that — the same list either way (`navigation.ts`), because two lists would be two role
 * rules to keep in step.
 *
 * It is given the session rather than reading it: the shell asks once and both halves are
 * handed the answer, which is what keeps a page render down to one call to `/auth/me`.
 */
export const Sidebar = ({ user }: { user: User | null }) => (
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

    <NavLinks user={user} className="flex-1" />

    <AccountPanel user={user} />
  </aside>
);
