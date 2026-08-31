import { PencilIcon, UsersIcon } from "lucide-react";
import type { Listing } from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ROUTES } from "#shared/config";
import { countOf, formatMoney } from "#shared/lib";
import { ButtonLink } from "#shared/ui";

/**
 * A listing as its owner sees it: the same row the catalogue draws, leading to the form
 * that edits it rather than to the page a guest books from. Both are offered — an owner
 * checking what a listing looks like is one link away from it.
 */
export const ListingCard = ({ listing }: { listing: Listing }) => (
  <Card className="h-full">
    <CardHeader>
      <CardTitle>{listing.title}</CardTitle>
      <CardDescription className="flex items-center gap-1.5">
        <UsersIcon className="size-3.5" />
        {countOf(listing.capacity, "guest")}
      </CardDescription>
      <CardAction>
        <Badge variant="outline" className="h-6">
          {formatMoney(listing.pricePerNight)} a night
        </Badge>
      </CardAction>
    </CardHeader>
    <CardContent>
      <p className="line-clamp-3 text-sm text-muted-foreground">
        {listing.description}
      </p>
    </CardContent>
    <CardFooter className="gap-2">
      <ButtonLink
        href={ROUTES.editListing(listing.id)}
        variant="outline"
        size="sm"
      >
        <PencilIcon />
        Edit
      </ButtonLink>
      <ButtonLink href={ROUTES.listing(listing.id)} variant="ghost" size="sm">
        View as a guest
      </ButtonLink>
    </CardFooter>
  </Card>
);
