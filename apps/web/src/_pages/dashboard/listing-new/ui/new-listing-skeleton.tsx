import { ListingFormSkeleton } from "#features/save-listing";
import { NewListingCard } from "./new-listing-card";

/**
 * The wait `app/dashboard/listings/new/loading.tsx` draws: the screen's own frame around
 * the form's wait. Without it the nearest `loading.tsx` is the section's own, a grid of
 * listing cards that would then give way to a single form.
 */
export const NewListingSkeleton = () => (
  <NewListingCard>
    <ListingFormSkeleton />
  </NewListingCard>
);
