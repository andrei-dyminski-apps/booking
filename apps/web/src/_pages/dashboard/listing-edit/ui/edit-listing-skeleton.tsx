import { ListingFormSkeleton } from "#features/save-listing";
import { EditListingCard } from "./edit-listing-card";

/**
 * The wait `app/dashboard/listings/[id]/loading.tsx` draws: the screen's own frame around
 * the form's wait. Without it the nearest `loading.tsx` is the section's own, a grid of
 * listing cards that would then give way to a single form.
 */
export const EditListingSkeleton = () => (
  <EditListingCard>
    <ListingFormSkeleton editing />
  </EditListingCard>
);
