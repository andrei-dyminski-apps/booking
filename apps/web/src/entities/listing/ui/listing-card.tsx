import type { ReactNode } from "react";
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
 * A listing as somebody who may change it sees it — its owner on the dashboard, the admin
 * in their section. It leads to the form that edits it as well as to the page a guest
 * books from: whoever is checking what a listing looks like is one link away from it.
 *
 * `editHref` is the edit screen of whoever is looking, and `actions` the links only that
 * screen has a use for, drawn between the two.
 */
export const ListingCard = ({
  listing,
  editHref,
  actions,
}: {
  listing: Listing;
  editHref: string;
  actions?: ReactNode;
}) => (
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
      <ButtonLink href={editHref} variant="outline" size="sm">
        <PencilIcon />
        Edit
      </ButtonLink>
      {actions}
      <ButtonLink href={ROUTES.listing(listing.id)} variant="ghost" size="sm">
        View as a guest
      </ButtonLink>
    </CardFooter>
  </Card>
);
