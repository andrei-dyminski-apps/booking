import { Role } from "@repo/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { DeleteListingButton } from "#features/delete-listing";
import { ListingForm } from "#features/save-listing";
import { requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import { requireId, today } from "#shared/lib";
import { ownListing } from "../api/own-listing";

export const EditListingPage = async ({
  params,
}: PageProps<"/dashboard/listings/[id]">) => {
  const id = requireId((await params).id);
  const owner = await requireRole(Role.USER, ROUTES.editListing(id));
  const listing = await ownListing(owner.id, id);

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <CardTitle>Edit listing</CardTitle>
        <CardDescription>
          Saved through `PATCH /listings/:id`, which compares the owner of the
          row with the session before it writes anything.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ListingForm
          listing={listing}
          earliest={today()}
          extraAction={<DeleteListingButton listingId={listing.id} />}
        />
      </CardContent>
    </Card>
  );
};
