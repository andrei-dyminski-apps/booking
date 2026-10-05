import { CalendarCheckIcon, PencilIcon, UsersIcon } from "lucide-react";
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
import { countOf, filtersHref, formatMoney } from "#shared/lib";
import { ButtonLink } from "#shared/ui";

/**
 * A listing as the admin sees it: the owner's card, leading to the admin's own edit
 * screen, plus the one thing only this role has a use for — every stay taken against it,
 * which the admin's scope of `/bookings` answers and an owner's would only for their own.
 */
export const AdminListingCard = ({ listing }: { listing: Listing }) => (
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
    <CardFooter className="flex-wrap gap-2">
      <ButtonLink
        href={ROUTES.adminListing(listing.id)}
        variant="outline"
        size="sm"
      >
        <PencilIcon />
        Edit
      </ButtonLink>
      <ButtonLink
        href={filtersHref(ROUTES.bookings, { listingId: listing.id })}
        variant="ghost"
        size="sm"
      >
        <CalendarCheckIcon />
        Stays
      </ButtonLink>
      <ButtonLink href={ROUTES.listing(listing.id)} variant="ghost" size="sm">
        View as a guest
      </ButtonLink>
    </CardFooter>
  </Card>
);
