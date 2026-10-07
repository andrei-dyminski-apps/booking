"use client";

import { useState } from "react";
import { SlidersHorizontalIcon } from "lucide-react";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import { ListingFilterFields } from "#features/listing-search";
import { ROUTES } from "#shared/config";
import type { FieldErrors } from "#shared/lib";
import { ButtonLink, FilterForm } from "#shared/ui";
import {
  catalogueHref,
  clearedFiltersHref,
  type FilterValues,
} from "../lib/catalogue-search";

/**
 * Every filter the catalogue takes, in a popup. The form inside it is a `GET` form:
 * submitting it writes the filters into the URL and the browser goes there, so the popup
 * needs no action and nothing to keep in step with the boxes — the values come back out of
 * the address the server rendered from.
 *
 * Where there is JavaScript, `FilterForm` navigates to the canonical address itself rather
 * than submitting every box and letting the page redirect: the long form of the search
 * would otherwise appear in the address bar and be replaced a round trip later. The link
 * it goes to is written by `catalogueHref`, the same function the chips and the ordering
 * use.
 *
 * It is a client component because opening a dialog is what a client component is for.
 * The boxes are all behind it, so a visitor whose scripts never arrive cannot ask a
 * question of their own any more — what they can still do is read the catalogue and take a
 * filter off a search somebody sent them, because a chip is a link. That is the trade the
 * compact toolbar is: the screen above the list is two controls rather than a panel.
 *
 * The dialog is open state and nothing else, and it is here because the navigation is a
 * client one now: a document navigation used to take the popup with it, and a soft one
 * leaves it standing.
 */
export const CatalogueFiltersDialog = ({
  values,
  errors,
  earliest,
  count,
}: {
  values: FilterValues;
  errors: FieldErrors;
  /** Today in UTC, from the server — see `shared/lib/dates.ts`. */
  earliest: string;
  /** How many filters are on, for the badge on the button that opens this. */
  count: number;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontalIcon />
        Filters
        {count > 0 && (
          <Badge variant="default" className="ml-1">
            {count}
          </Badge>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Filter the catalogue</DialogTitle>
          <DialogDescription>
            A search is a link: whatever is applied here ends up in the address
            bar and can be sent to somebody else.
          </DialogDescription>
        </DialogHeader>

        {/*
          The fields are read as they were submitted rather than merged into the search
          that is on the screen: a form carries what it carries, so a filter with no box
          in this dialog — and the cursor, which never has one — is left behind exactly as
          a document submit would leave it.

          `noValidate` lives in `FilterForm`, for the reason every other form here carries
          it: the boxes below state `min` and `step` so that a keypad offers the right
          thing, and the browser would otherwise refuse a submit over them with a message
          of its own — in its own words, in its own place, and before `listingQuerySchema`
          has said anything. The refusal that matters is the contract's, and it is already
          on the screen: a search arrives out of a URL, so a value the schema refuses
          reaches this dialog filled in, and a submit the browser blocks would leave a
          visitor with a box they cannot correct by pressing the only button in front of
          them.
        */}
        <FilterForm
          action={ROUTES.catalogue}
          href={(fields) =>
            catalogueHref({
              from: fields.from ?? "",
              to: fields.to ?? "",
              minPrice: fields.minPrice ?? "",
              maxPrice: fields.maxPrice ?? "",
              guests: fields.guests ?? "",
              sort: fields.sort ?? "",
            })
          }
          onNavigate={() => setOpen(false)}
        >
          <div className="grid gap-4">
            <ListingFilterFields
              values={values}
              errors={errors}
              earliest={earliest}
            />
          </div>

          {/*
            The ordering is not one of the boxes — it is the select in the toolbar — but
            this form still has to carry it: a form submits every field it has, and without
            this one showing the stays would put them back in the order they were
            published.
          */}
          <input type="hidden" name="sort" defaultValue={values.sort} />

          <DialogFooter>
            {/*
              It closes the dialog like the submit beside it: the boxes are uncontrolled,
              so a soft navigation that left the popup standing would leave them holding
              the filters this link has just taken off.
            */}
            <ButtonLink
              href={clearedFiltersHref(values)}
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Clear all
            </ButtonLink>
            <Button type="submit">Show stays</Button>
          </DialogFooter>
        </FilterForm>
      </DialogContent>
    </Dialog>
  );
};
