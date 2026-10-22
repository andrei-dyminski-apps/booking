import type { ReactNode } from "react";
import { ListingFormCard } from "#features/save-listing";

/**
 * The frame of this screen — its title and line — drawn by the page around the form and
 * by the skeleton around the form's wait, so the two are one shape.
 */
export const EditListingCard = ({ children }: { children: ReactNode }) => (
  <ListingFormCard
    title="Edit listing"
    description="You are editing somebody else's listing. The owner keeps it, and sees your changes on their dashboard."
  >
    {children}
  </ListingFormCard>
);
