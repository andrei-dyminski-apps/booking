import { Skeleton } from "@repo/ui/components/skeleton";

/**
 * What `app/listings/loading.tsx` shows while the page is being rendered on the server.
 * The catalogue is the one screen where that wait is worth drawing: its read is cached
 * and usually instant, but a cold entry means a round trip to the API with a search the
 * visitor has just typed, and a blank page under the filters reads as an empty result.
 *
 * The shape matches the real one — a row of controls and a grid of cards — so nothing
 * jumps when the answer arrives.
 */
export const CatalogueSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-72" />
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-7 w-24 rounded-lg" />
      <Skeleton className="h-7 w-44 rounded-lg" />
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-40 w-full rounded-xl" />
      ))}
    </div>
  </div>
);
