import type { ReactNode } from "react";
import { cn } from "@repo/ui/lib/utils";
import { badgeCount } from "#shared/lib";

/**
 * The pill an unread count is drawn in, for the two counts the shell shows: `sm` on the
 * corner of the bell, `md` at the end of the Messages link. The number is `badgeCount`'s,
 * so both stop at the same ceiling; what a screen reader hears is the caller's to say,
 * because one of the two is inside a button that names itself.
 */
export const CountBadge = ({
  count,
  size,
  className,
  children,
}: {
  count: number;
  size: "sm" | "md";
  className?: string;
  /** Anything beside the number — the sentence a screen reader reads in its place. */
  children?: ReactNode;
}) => (
  <span
    className={cn(
      "flex items-center justify-center rounded-full bg-primary leading-none font-medium text-primary-foreground tabular-nums",
      size === "sm"
        ? "h-4 min-w-4 px-1 text-[10px]"
        : "h-5 min-w-5 px-1.5 text-[11px]",
      className,
    )}
  >
    <span aria-hidden>{badgeCount(count)}</span>
    {children}
  </span>
);
