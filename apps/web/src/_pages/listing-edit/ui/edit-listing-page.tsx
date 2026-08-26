import { Role } from "@repo/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ListingForm } from "#features/save-listing";
import { requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import { ownListing } from "../api/own-listing";
import { DeleteListingButton } from "./delete-listing-button";

export const EditListingPage = async ({
  params,
}: PageProps<"/dashboard/listings/[id]">) => {
  const { id } = await params;
  const owner = await requireRole(Role.OWNER, ROUTES.editListing(id));
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
        <ListingForm listing={listing} />
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-4">
        <DeleteListingButton listingId={listing.id} />
      </CardFooter>
    </Card>
  );
};
