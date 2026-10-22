import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/messages/[id]/loading.tsx` draws: a thread is personal, never cached. */
export const ConversationSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-32" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-64" />
      </div>
    </div>

    <div className="flex flex-col gap-3">
      <Skeleton className="h-14 w-3/5 self-start rounded-xl" />
      <Skeleton className="h-14 w-1/2 self-end rounded-xl" />
      <Skeleton className="h-14 w-2/5 self-start rounded-xl" />
    </div>

    <Skeleton className="h-32 w-full rounded-xl" />
  </div>
);
