import type { ReactNode } from "react";
import { ListingFormCard } from "#features/save-listing";

/**
 * The frame of this screen — its title and line — drawn by the page around the form and
 * by the skeleton around the form's wait, so the two are one shape.
 */
export const NewListingCard = ({ children }: { children: ReactNode }) => (
  <ListingFormCard
    title="New listing"
    description="The owner is taken from the session, never from the form — the API refuses a listing written in somebody else's name."
  >
    {children}
  </ListingFormCard>
);
