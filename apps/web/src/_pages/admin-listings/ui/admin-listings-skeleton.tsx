import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/admin/loading.tsx` draws — this read is `no-store`, so it is never instant. */
export const AdminListingsSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-4 w-80" />
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-44 w-full rounded-xl" />
      ))}
    </div>
  </div>
);
