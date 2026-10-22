import Link from "next/link";
import { UserIcon } from "lucide-react";
import type { WaitlistDemandEntry } from "@repo/contracts";
import { ROUTES } from "#shared/config";
import { EntryCard } from "./entry-card";

/**
 * The ranges waited for on somebody's listings — demand for nights already taken. Who
 * waits is drawn only where the API names them, which is for an admin: a host learns
 * that a range is wanted, and the guest becomes theirs to know once they book it.
 */
export const DemandEntries = ({
  entries,
}: {
  entries: WaitlistDemandEntry[];
}) => (
  <ul role="list" className="flex flex-col gap-4">
    {entries.map((entry) => (
      <li key={entry.id}>
        <EntryCard
          entry={entry}
          detail={
            entry.waiter !== null && (
              <span className="flex items-center gap-1.5">
                <UserIcon className="size-3.5" />
                <Link
                  href={ROUTES.adminUser(entry.waiter.id)}
                  className="hover:underline"
                >
                  {entry.waiter.name}
                </Link>
              </span>
            )
          }
        />
      </li>
    ))}
  </ul>
);
