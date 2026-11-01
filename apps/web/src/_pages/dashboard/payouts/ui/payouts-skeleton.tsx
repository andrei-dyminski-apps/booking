import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/dashboard/payouts/loading.tsx` draws — the account is never cached. */
export const PayoutsSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-28 rounded-lg" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
    </div>

    <Skeleton className="h-96 w-full rounded-xl" />
  </div>
);
