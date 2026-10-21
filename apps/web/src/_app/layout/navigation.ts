import {
  BuildingIcon,
  CalendarCheckIcon,
  HomeIcon,
  LayoutDashboardIcon,
  MessagesSquareIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { Role, type User } from "@repo/contracts";
import { ROUTES } from "#shared/config";

export type NavItem = {
  href: string;
  label: string;
  /** What the section is for, shown where there is room for a second line. */
  hint: string;
  icon: LucideIcon;
};

/**
 * What the shell offers this visitor, in one list because two places draw it: the sidebar
 * on a wide screen and the sheet behind the menu button on a narrow one. Writing it twice
 * would be two lists to keep in step, and the role rules below are exactly the kind that
 * drift apart when they are.
 *
 * It offers, it does not permit. Every section behind these links answers the same way
 * with or without one — the API reads the role out of the access token on every request —
 * so what is decided here is what is worth putting on the screen, not who may pass.
 *
 * The module is imported by a client component (`nav-links.tsx`) as well as by the server
 * one, which is why the icons are function references rather than props: a component
 * cannot cross the RSC boundary as data, and both sides import this list instead of one
 * of them handing it over.
 */
export function navigationFor(user: User | null): NavItem[] {
  const items: NavItem[] = [
    { href: ROUTES.home, label: "Home", hint: "Start here", icon: HomeIcon },
    {
      href: ROUTES.catalogue,
      label: "Stays",
      hint: "Everything on offer",
      icon: BuildingIcon,
    },
  ];

  if (user === null) return items;

  // Every signed-in role has a scope on `GET /bookings` — a user the stays they took and
  // the stays taken against their listings, an admin all of them — so every one of them
  // has a use for the link, and the page says which it is showing.
  items.push({
    href: ROUTES.bookings,
    label: "Bookings",
    hint: "Stays and holds",
    icon: CalendarCheckIcon,
  });

  // A thread has two sides, a guest and the host of a listing, and nobody else reads it —
  // the API refuses an admin the route, so the shell does not offer it. Hosting is owning
  // a listing rather than a role, so every user gets the dashboard too: it is where the
  // first listing is published from. Membership of a set rather than a hierarchy, the way
  // `RolesGuard` reads it: an admin does not reach a user's screens by being senior to one.
  if (user.role === Role.USER) {
    items.push(
      {
        href: ROUTES.messages,
        label: "Messages",
        hint: "Guests and hosts",
        icon: MessagesSquareIcon,
      },
      {
        href: ROUTES.dashboard,
        label: "Dashboard",
        hint: "Your listings",
        icon: LayoutDashboardIcon,
      },
    );
  }

  // The admin's section is two screens rather than one, because they answer two different
  // questions — what is on offer, and who may use the site — and an admin reaches for each
  // on its own.
  if (user.role === Role.ADMIN) {
    items.push(
      {
        href: ROUTES.admin,
        label: "Listings",
        hint: "Everything on offer, editable",
        icon: ShieldIcon,
      },
      {
        href: ROUTES.adminUsers,
        label: "Users",
        hint: "Accounts and roles",
        icon: UsersIcon,
      },
    );
  }

  items.push({
    href: ROUTES.profile,
    label: "Profile",
    hint: "Your account",
    icon: UserIcon,
  });

  return items;
}
