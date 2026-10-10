import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/guests/[id]/reviews/loading.tsx` draws — the read is `no-store`. */
export const GuestReviewsSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-24 rounded-lg" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
    </div>

    <Skeleton className="h-5 w-48" />
    <div className="flex flex-col gap-3">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  </div>
);
