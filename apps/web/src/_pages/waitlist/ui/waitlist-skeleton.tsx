import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/waitlist/loading.tsx` draws: both reads are personal, so never cached. */
export const WaitlistSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-4 w-80" />
    </div>

    <div className="flex gap-2">
      <Skeleton className="h-7 w-24 rounded-lg" />
      <Skeleton className="h-7 w-32 rounded-lg" />
    </div>

    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  </div>
);
