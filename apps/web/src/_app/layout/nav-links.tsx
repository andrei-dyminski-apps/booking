"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "@repo/contracts";
import { cn } from "@repo/ui/lib/utils";
import { ROUTES } from "#shared/config";
import { navigationFor } from "./navigation";
import { UnreadConversationsBadge } from "./unread-conversations-badge";

/**
 * The links of the shell, with the one thing a server render cannot know about itself:
 * which of them the visitor is currently looking at. That is the whole reason this is a
 * client component — `usePathname` is a hook, and the list beside it is computed from a
 * plain object the server hands over.
 *
 * A section is current when the path is inside it, not only when it is the path exactly:
 * `/listings/:id` is still the catalogue and `/dashboard/listings/new` is still the
 * dashboard. Home is the exception, because every path starts with `/`.
 *
 * Only one link is current, and it is the deepest one that contains the path: `/admin`
 * contains `/admin/users` as surely as the users link does, and two sections lit up at
 * once would say the visitor is in both.
 */
export const NavLinks = ({
  user,
  onNavigate,
  className,
}: {
  user: User | null;
  /** The sheet closes behind the link it opened; the sidebar has nothing to close. */
  onNavigate?: () => void;
  className?: string;
}) => {
  const pathname = usePathname();
  const items = navigationFor(user);
  const currentHref = items
    .map((item) => item.href)
    .filter((href) => contains(href, pathname))
    .reduce<string | null>(
      (deepest, href) =>
        deepest === null || href.length > deepest.length ? href : deepest,
      null,
    );

  return (
    <nav className={cn("flex flex-col gap-1", className)}>
      {items.map(({ href, label, hint, icon: Icon }) => {
        const current = href === currentHref;

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={current ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              current
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{label}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {hint}
              </span>
            </span>
            {href === ROUTES.messages && <UnreadConversationsBadge />}
          </Link>
        );
      })}
    </nav>
  );
};

function contains(href: string, pathname: string): boolean {
  if (href === "/") return pathname === href;

  return pathname === href || pathname.startsWith(`${href}/`);
}
