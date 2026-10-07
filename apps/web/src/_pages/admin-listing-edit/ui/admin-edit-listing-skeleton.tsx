import { Skeleton } from "@repo/ui/components/skeleton";

/**
 * The wait `app/admin/listings/[id]/loading.tsx` draws — the read is `no-store`. Without
 * it the nearest one is `app/admin/loading.tsx`, a grid of listing cards that would then
 * give way to a single form.
 */
export const AdminEditListingSkeleton = () => (
  <div className="mx-auto flex w-full max-w-xl flex-col gap-6 rounded-xl border p-6">
    <div className="flex flex-col gap-2">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-4 w-full" />
    </div>

    <div className="flex flex-col gap-5">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>

    <div className="flex flex-col gap-2 sm:flex-row">
      <Skeleton className="h-10 w-full sm:w-28" />
      <Skeleton className="h-10 w-full sm:w-24" />
    </div>
  </div>
);
