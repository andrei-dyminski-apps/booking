import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/bookings/loading.tsx` draws: this read is personal, so it is never cached. */
export const BookingsSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-4 w-80" />
    </div>

    {/*
      The toolbar: the button that opens the filters, and the ordering beside it. Both are
      the `sm` size of their primitive, so both are `h-7` — the height is the whole point
      of drawing them at all, and one off by a step is the jump this file exists to avoid.
    */}
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-7 w-24 rounded-lg" />
      <Skeleton className="h-7 w-44 rounded-lg" />
    </div>

    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  </div>
);
