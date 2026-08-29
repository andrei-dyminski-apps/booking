import Link from "next/link";
import { PencilIcon, UsersIcon } from "lucide-react";
import type { Listing } from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import { buttonVariants } from "@repo/ui/components/button";
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
import { formatMoney } from "#shared/lib";

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
        {listing.capacity} {listing.capacity === 1 ? "guest" : "guests"}
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
      <Link
        href={ROUTES.editListing(listing.id)}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <PencilIcon />
        Edit
      </Link>
      <Link
        href={ROUTES.listing(listing.id)}
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        View as a guest
      </Link>
    </CardFooter>
  </Card>
);
