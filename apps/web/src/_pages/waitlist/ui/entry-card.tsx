import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarIcon, MoonIcon } from "lucide-react";
import type { WaitlistEntry } from "@repo/contracts";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ROUTES } from "#shared/config";
import { countOf, formatDay, nightsBetween } from "#shared/lib";

/**
 * One range waited for: the listing, the dates and the nights. Both sides draw it, and
 * each hands in what it may do or know beyond that — the waiter's own "Leave", the
 * admin's line naming who waits.
 */
export const EntryCard = ({
  entry,
  detail,
  action,
}: {
  entry: WaitlistEntry;
  detail?: ReactNode;
  action?: ReactNode;
}) => (
  <Card>
    <CardHeader>
      <CardTitle>
        <Link
          href={ROUTES.listing(entry.listingId)}
          className="hover:underline"
        >
          {entry.listing.title}
        </Link>
      </CardTitle>
      <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <CalendarIcon className="size-3.5" />
          {formatDay(entry.from)} → {formatDay(entry.to)}
        </span>
        <span className="flex items-center gap-1.5">
          <MoonIcon className="size-3.5" />
          {countOf(nightsBetween(entry.from, entry.to), "night")}
        </span>
        {detail}
      </CardDescription>
      {action !== undefined && <CardAction>{action}</CardAction>}
    </CardHeader>
  </Card>
);
