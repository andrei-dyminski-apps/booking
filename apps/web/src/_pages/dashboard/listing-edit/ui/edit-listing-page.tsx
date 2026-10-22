import { Role } from "@repo/contracts";
import { DeleteListingButton } from "#features/delete-listing";
import { ListingForm } from "#features/save-listing";
import { requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import { requireId, today } from "#shared/lib";
import { ownListing } from "../api/own-listing";
import { EditListingCard } from "./edit-listing-card";

export const EditListingPage = async ({
  params,
}: PageProps<"/dashboard/listings/[id]">) => {
  const id = requireId((await params).id);
  const owner = await requireRole(Role.USER, ROUTES.editListing(id));
  const listing = await ownListing(owner.id, id);

  return (
    <EditListingCard>
      <ListingForm
        listing={listing}
        earliest={today()}
        extraAction={<DeleteListingButton listingId={listing.id} />}
      />
    </EditListingCard>
  );
};
