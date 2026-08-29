"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "@repo/contracts";
import { cn } from "@repo/ui/lib/utils";
import { navigationFor } from "./navigation";

/**
 * The links of the shell, with the one thing a server render cannot know about itself:
 * which of them the visitor is currently looking at. That is the whole reason this is a
 * client component — `usePathname` is a hook, and the list beside it is computed from a
 * plain object the server hands over.
 *
 * A section is current when the path is inside it, not only when it is the path exactly:
 * `/listings/:id` is still the catalogue and `/dashboard/listings/new` is still the
 * dashboard. Home is the exception, because every path starts with `/`.
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

  return (
    <nav className={cn("flex flex-col gap-1", className)}>
      {navigationFor(user).map(({ href, label, hint, icon: Icon }) => {
        const current = isCurrent(pathname, href);

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
          </Link>
        );
      })}
    </nav>
  );
};

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === href;

  return pathname === href || pathname.startsWith(`${href}/`);
}
