import type { WaitlistEntry } from "@repo/contracts";
import { EntryCard } from "./entry-card";
import { LeaveWaitlistButton } from "./leave-waitlist-button";

/**
 * The ranges a user waits for: stays they want and could not take yet. A wish, not a hold
 * — when the nights come free everybody waiting for them is told at once, the first to
 * book takes them, and the entry is gone from here the moment the notice is written. The
 * API answers the list whole, capped at `MAX_WAITLIST_ENTRIES`, so it has no pages.
 */
export const OwnEntries = ({ entries }: { entries: WaitlistEntry[] }) => (
  <ol role="list" className="flex flex-col gap-4">
    {entries.map((entry) => (
      <li key={entry.id}>
        <EntryCard
          entry={entry}
          action={<LeaveWaitlistButton entryId={entry.id} />}
        />
      </li>
    ))}
  </ol>
);
