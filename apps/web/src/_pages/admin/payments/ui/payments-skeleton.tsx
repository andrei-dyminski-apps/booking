import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/admin/payments/loading.tsx` draws — every read of the screen is `no-store`. */
export const PaymentsSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>

    {/* The tabs, `h-7` each, and the line saying what the list is. */}
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-7 w-32 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-4 w-full max-w-xl" />
    </div>

    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-40 w-full rounded-xl" />
      ))}
    </div>
  </div>
);
