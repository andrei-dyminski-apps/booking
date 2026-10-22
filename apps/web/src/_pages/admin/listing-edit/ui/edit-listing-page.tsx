import { Role } from "@repo/contracts";
import { DeleteListingButton } from "#features/delete-listing";
import { ListingForm } from "#features/save-listing";
import { requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import { requireId, today } from "#shared/lib";
import { anyListing } from "../api/any-listing";
import { EditListingCard } from "./edit-listing-card";

/**
 * The owner's edit screen, opened by the role that may edit any row. The form and the
 * delete are the same features the owner runs — the rules they meet are the API's, and
 * the only thing this screen decides differently is which rows it shows and where
 * "Cancel" leads.
 */
export const EditListingPage = async ({
  params,
}: PageProps<"/admin/listings/[id]">) => {
  const id = requireId((await params).id);

  await requireRole(Role.ADMIN, ROUTES.adminListing(id));

  const listing = await anyListing(id);

  return (
    <EditListingCard>
      <ListingForm
        listing={listing}
        earliest={today()}
        cancelHref={ROUTES.admin}
        extraAction={<DeleteListingButton listingId={listing.id} />}
      />
    </EditListingCard>
  );
};
