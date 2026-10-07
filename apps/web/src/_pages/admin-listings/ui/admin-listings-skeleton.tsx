import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/admin/loading.tsx` draws — this read is `no-store`, so it is never instant. */
export const AdminListingsSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-4 w-80" />
    </div>

    {/* The toolbar: the filters button and the ordering, both `h-7`. */}
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-7 w-24 rounded-lg" />
      <Skeleton className="h-7 w-44 rounded-lg" />
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-44 w-full rounded-xl" />
      ))}
    </div>
  </div>
);
