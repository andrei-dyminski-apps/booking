import { Role } from "@repo/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { DeleteListingButton } from "#features/delete-listing";
import { ListingForm } from "#features/save-listing";
import { requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import { requireId } from "#shared/lib";
import { anyListing } from "../api/any-listing";

/**
 * The owner's edit screen, opened by the role that may edit any row. The form and the
 * delete are the same features the owner runs — the rules they meet are the API's, and
 * the only thing this screen decides differently is which rows it shows and where
 * "Cancel" leads.
 */
export const AdminEditListingPage = async ({
  params,
}: PageProps<"/admin/listings/[id]">) => {
  const id = requireId((await params).id);

  await requireRole(Role.ADMIN, ROUTES.adminListing(id));

  const listing = await anyListing(id);

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <CardTitle>Edit listing</CardTitle>
        <CardDescription>
          You are editing somebody else&apos;s listing. The owner keeps it, and
          sees your changes on their dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ListingForm listing={listing} cancelHref={ROUTES.admin} />
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-4">
        <DeleteListingButton listingId={listing.id} />
      </CardFooter>
    </Card>
  );
};
