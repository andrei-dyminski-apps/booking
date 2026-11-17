import { Skeleton } from "@repo/ui/components/skeleton";

/** The wait `app/profile/loading.tsx` draws — the session is read per request. */
export const ProfileSkeleton = () => (
  <Skeleton className="mx-auto h-80 w-full max-w-md rounded-xl" />
);
