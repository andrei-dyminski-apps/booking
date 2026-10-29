import { Skeleton } from "@repo/ui/components/skeleton";

/**
 * The wait `app/bookings/[id]/loading.tsx` draws: the way back, the heading, and the card
 * the stay is drawn in. Whether a payment form follows is not known until the booking is,
 * so the card stops where the form would begin.
 */
export const BookingSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-20 rounded-lg" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
    </div>

    <Skeleton className="h-40 w-full rounded-xl" />
  </div>
);
