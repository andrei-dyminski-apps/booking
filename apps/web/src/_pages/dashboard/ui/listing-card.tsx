import Link from "next/link";
import type { Listing } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ROUTES } from "#shared/config";

/**
 * An explicit locale, or the server and the browser would disagree on the separators.
 * The column stores minor units, so the price is divided here and nowhere else — every
 * value that reaches the API keeps the unit the contract gives it.
 */
const price = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const ListingCard = ({ listing }: { listing: Listing }) => (
  <Card>
    <CardHeader>
      <CardTitle>{listing.title}</CardTitle>
      <CardDescription>
        {price.format(listing.pricePerNight / 100)} a night · {listing.capacity}{" "}
        {listing.capacity === 1 ? "guest" : "guests"}
      </CardDescription>
      <CardAction>
        <Button
          variant="outline"
          size="sm"
          render={<Link href={ROUTES.editListing(listing.id)} />}
        >
          Edit
        </Button>
      </CardAction>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-muted-foreground">{listing.description}</p>
    </CardContent>
  </Card>
);
