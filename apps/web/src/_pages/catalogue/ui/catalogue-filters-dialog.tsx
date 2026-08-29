"use client";

import Link from "next/link";
import { SlidersHorizontalIcon } from "lucide-react";
import { Badge } from "@repo/ui/components/badge";
import { Button, buttonVariants } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import { ROUTES } from "#shared/config";
import type { FieldErrors } from "#shared/lib";
import { clearedFiltersHref, type FilterValues } from "../lib/catalogue-search";
import { FilterField } from "./filter-field";

/**
 * Every filter the catalogue takes, in a popup. The form inside it is a plain
 * `method="get"` one: submitting it writes the filters into the URL and the browser
 * performs the navigation, so the popup needs no action, no state and nothing to keep in
 * step with the boxes.
 *
 * It is a client component because opening a dialog is what a client component is for.
 * The boxes are all behind it, so a visitor whose scripts never arrive cannot ask a
 * question of their own any more — what they can still do is read the catalogue and take a
 * filter off a search somebody sent them, because a chip is a link. That is the trade the
 * compact toolbar is: the screen above the list is two controls rather than a panel.
 *
 * The dialog does not have to close itself. A `GET` form submits as a document
 * navigation, so the page it lands on is a new one — with the search it was asked for
 * already in the address bar.
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
}) => (
  <Dialog>
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

      <form
        method="get"
        action={ROUTES.catalogue}
        className="contents"
        // The popup is portalled out of this subtree, so the grid of the dialog is what
        // lays these out — `contents` keeps the form from becoming a box inside it.
        //
        // `noValidate` for the reason every other form here carries it: the boxes below
        // state `min` and `step` so that a keypad offers the right thing, and the browser
        // would otherwise refuse a submit over them with a message of its own — in its
        // own words, in its own place, and before `listingQuerySchema` has said anything.
        // The refusal that matters is the contract's, and it is already on the screen:
        // a search arrives out of a URL, so a value the schema refuses reaches this dialog
        // filled in, and a submit the browser blocks would leave a visitor with a box they
        // cannot correct by pressing the only button in front of them.
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FilterField
            name="from"
            label="Check in"
            type="date"
            min={earliest}
            value={values.from}
            error={errors.from}
          />
          <FilterField
            name="to"
            label="Check out"
            type="date"
            min={earliest}
            value={values.to}
            error={errors.to}
          />
          <FilterField
            name="minPrice"
            label="Price from"
            type="number"
            min={0}
            step={0.01}
            value={values.minPrice}
            error={errors.minPrice}
            description="Per night."
          />
          <FilterField
            name="maxPrice"
            label="Price to"
            type="number"
            // A cent, not zero: a ceiling of nothing is a search with no answer, and the
            // contract says so with `positive()` where `minPrice` says `nonnegative()`.
            // The box agrees with it rather than sending a value it will refuse.
            min={0.01}
            step={0.01}
            value={values.maxPrice}
            error={errors.maxPrice}
            description="120.50 is a hundred and twenty fifty."
          />
          <FilterField
            name="guests"
            label="Guests"
            type="number"
            min={1}
            value={values.guests}
            error={errors.guests}
          />
        </div>

        {/*
          The ordering is not one of the boxes — it is the select in the toolbar — but this
          form still has to carry it: a form submits every field it has, and without this
          one showing the stays would put them back in the order they were published in.
        */}
        <input type="hidden" name="sort" defaultValue={values.sort} />

        <DialogFooter>
          <Link
            href={clearedFiltersHref(values)}
            className={buttonVariants({ variant: "ghost" })}
          >
            Clear all
          </Link>
          <Button type="submit">Show stays</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
);
