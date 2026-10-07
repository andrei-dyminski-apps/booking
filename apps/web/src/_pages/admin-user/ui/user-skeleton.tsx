import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/admin/users/[id]/loading.tsx` draws — the read is `no-store`. */
export const UserSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-24 rounded-lg" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-40" />
      </div>
    </div>

    <Skeleton className="h-36 w-full rounded-xl" />
    <Skeleton className="h-32 w-full rounded-xl" />
  </div>
);
