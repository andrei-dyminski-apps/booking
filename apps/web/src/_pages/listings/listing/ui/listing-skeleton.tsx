import { Skeleton } from "@repo/ui/components/skeleton";

/**
 * The wait `app/listings/[id]/loading.tsx` draws. Both reads behind this page are cached,
 * so it is usually the first visitor after an edit or a booking who sees it — which is
 * exactly the moment a blank screen would look like a listing that had gone.
 */
export const ListingSkeleton = () => (
  <div className="flex flex-col gap-8">
    <div className="flex flex-col gap-3">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full max-w-2xl" />
    </div>

    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="grid gap-6 sm:grid-cols-2">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-64 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  </div>
);
