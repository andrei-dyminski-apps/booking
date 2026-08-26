import { Role } from "@repo/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ListingForm } from "#features/save-listing";
import { requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";

export const NewListingPage = async () => {
  await requireRole(Role.OWNER, ROUTES.newListing);

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <CardTitle>New listing</CardTitle>
        <CardDescription>
          The owner is taken from the session, never from the form — the API
          refuses a listing written in somebody else&apos;s name.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ListingForm />
      </CardContent>
    </Card>
  );
};
