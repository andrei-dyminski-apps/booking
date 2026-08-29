import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/bookings/loading.tsx` draws: this read is personal, so it is never cached. */
export const BookingsSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-4 w-80" />
    </div>

    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  </div>
);
