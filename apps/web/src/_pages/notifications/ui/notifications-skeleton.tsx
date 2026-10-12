import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/notifications/loading.tsx` draws — the read is `no-store`. */
export const NotificationsSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>

    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  </div>
);
