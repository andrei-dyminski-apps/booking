import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/admin/users/loading.tsx` draws — the read is `no-store`. */
export const UsersSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-4 w-80" />
    </div>

    {/* The toolbar: the filters button and the ordering, both `h-7`. */}
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-7 w-24 rounded-lg" />
      <Skeleton className="h-7 w-44 rounded-lg" />
    </div>

    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  </div>
);
