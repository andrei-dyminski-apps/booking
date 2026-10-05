import {
  BuildingIcon,
  CalendarCheckIcon,
  HomeIcon,
  LayoutDashboardIcon,
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

  // Every signed-in role has a scope on `GET /bookings` — a guest sees the stays they
  // took, an owner the stays taken against their listings, an admin all of them — so
  // every one of them has a use for the link, and the page says which of the three it is.
  items.push({
    href: ROUTES.bookings,
    label: "Bookings",
    hint: "Stays and holds",
    icon: CalendarCheckIcon,
  });

  // Membership of a set rather than a hierarchy, the way `RolesGuard` reads it: an admin
  // does not reach an owner's dashboard by being senior to one. `GET /listings/mine` is
  // scoped to the caller, and an admin has no listings of their own to put on it.
  if (user.role === Role.OWNER) {
    items.push({
      href: ROUTES.dashboard,
      label: "Dashboard",
      hint: "Your listings",
      icon: LayoutDashboardIcon,
    });
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
