import { Role } from "@repo/contracts";
import { ListingForm } from "#features/save-listing";
import { requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import { today } from "#shared/lib";
import { NewListingCard } from "./new-listing-card";

export const NewListingPage = async () => {
  await requireRole(Role.USER, ROUTES.newListing);

  return (
    <NewListingCard>
      <ListingForm earliest={today()} />
    </NewListingCard>
  );
};
