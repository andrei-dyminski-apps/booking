import type { ReactNode } from "react";
import { Skeleton } from "@repo/ui/components/skeleton";

/**
 * The wait of `ListingForm`, box for box — the four fields, both price groups and the
 * button row. It draws the form and nothing around it: the card, the title and the line
 * under it belong to each screen, which puts this inside the same frame its page draws
 * the form in, so the two cannot drift apart.
 *
 * `editing` is a screen that waits for a listing, and that wait ends at the legend of the
 * date prices. How many rows the listing has is not known until it arrives, and every
 * box below them — the "Add a date" button, the button row — would move down when they
 * appear; a form that grows under a finished skeleton moves nothing that was already
 * drawn. A new listing has no rows, so its wait is the whole form.
 */
export const ListingFormSkeleton = ({
  editing = false,
}: {
  editing?: boolean;
}) => (
  <div className="flex flex-col gap-5">
    <div className="flex flex-col gap-5">
      <BoxSkeleton label="w-12" />
      <BoxSkeleton label="w-24" box="h-24" />
      <BoxSkeleton label="w-40" />
      <BoxSkeleton label="w-20" />

      <Skeleton className="h-px w-full" />

      <GroupSkeleton legend="w-48">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6].map((index) => (
            <BoxSkeleton key={index} label="w-16" box="h-8" />
          ))}
        </div>
      </GroupSkeleton>

      {editing ? (
        <Skeleton className="mb-1.5 h-5 w-44" />
      ) : (
        <GroupSkeleton legend="w-44">
          <Skeleton className="h-8 w-24 rounded-lg" />
        </GroupSkeleton>
      )}
    </div>

    {!editing && (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Skeleton className="h-9 w-full rounded-lg sm:w-32" />
        <Skeleton className="h-9 w-full rounded-lg sm:w-20" />
      </div>
    )}
  </div>
);

/** A label and the box under it, `FormField`'s shape. */
const BoxSkeleton = ({
  label,
  box = "h-9",
}: {
  label: string;
  box?: string;
}) => (
  <div className="flex flex-col gap-2">
    <Skeleton className={`h-4 ${label}`} />
    <Skeleton className={`w-full rounded-lg ${box}`} />
  </div>
);

/** A legend and what it groups, `HintFieldSet`'s shape. */
const GroupSkeleton = ({
  legend,
  children,
}: {
  legend: string;
  children: ReactNode;
}) => (
  <div className="flex flex-col gap-4">
    <Skeleton className={`mb-1.5 h-5 ${legend}`} />
    {children}
  </div>
);
