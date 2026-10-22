import Link from "next/link";
import { UsersIcon } from "lucide-react";
import type { Listing } from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ROUTES } from "#shared/config";
import { formatMoney } from "#shared/lib";

/**
 * A row of the catalogue as a stranger sees it. The owner's dashboard and the admin's
 * section share a card of their own (`entities/listing`), and this is deliberately not
 * it: this one leads to the page a guest books from, that one to the form that edits it.
 *
 * The whole card is the link, and it is drawn that way with one anchor stretched over it
 * (`after:absolute`) rather than by wrapping the card in an `<a>`. That keeps one link
 * per card in the accessibility tree, with the title as its name — a card wrapped whole
 * announces its price and description as part of the link text.
 */
export const CatalogueCard = ({ listing }: { listing: Listing }) => (
  <Card className="relative h-full transition-colors hover:bg-accent/40 focus-within:ring-2 focus-within:ring-ring">
    <CardHeader>
      <CardTitle>
        <Link
          href={ROUTES.listing(listing.id)}
          className="outline-none after:absolute after:inset-0 after:rounded-xl hover:underline"
        >
          {listing.title}
        </Link>
      </CardTitle>
      <CardDescription className="flex items-center gap-1.5">
        <UsersIcon className="size-3.5" />
        Sleeps {listing.capacity}
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
  </Card>
);
