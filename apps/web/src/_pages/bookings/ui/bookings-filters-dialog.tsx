"use client";

import { useState } from "react";
import { SlidersHorizontalIcon } from "lucide-react";
import { LookupKind } from "@repo/contracts";
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
import { ROUTES } from "#shared/config";
import type { FieldErrors } from "#shared/lib";
import {
  ButtonLink,
  FilterField,
  FilterForm,
  FilterSelect,
  LookupField,
} from "#shared/ui";
import {
  bookingsHref,
  clearedFiltersHref,
  statusOptions,
  type FilterValues,
} from "../lib/bookings-search";

/**
 * Every filter the stays screen takes, in a popup — the same shape the catalogue's filters
 * have, and for the same reasons. The form inside it is a `GET` form: submitting it writes
 * the filters into the URL and the browser goes there, so the popup needs no action and
 * nothing to keep in step with the boxes.
 *
 * Where there is JavaScript, `FilterForm` navigates to the canonical address itself rather
 * than submitting every box and letting the page redirect — the long form of the search
 * would otherwise show in the address bar and be replaced a round trip later. The dialog
 * closes itself along with it, which a document navigation used to do by taking the page
 * away.
 *
 * `noValidate` lives in `FilterForm`, for the reason every other form here carries it: a
 * value the contract refuses arrives out of a URL already filled in, and a submit the
 * browser blocked in its own words would leave a visitor with a box they cannot correct by
 * pressing the only button in front of them.
 *
 * The two id boxes are filled in by name (`LookupField`): a part of a title or an address
 * is looked up among the listings and the guests of the stays this session may read, and
 * what is picked goes into the URL as the id it always was. The link on a card still fills
 * them in through the URL, and the box then shows the name of what it names.
 */
export const BookingsFiltersDialog = ({
  values,
  errors,
  count,
  byGuest,
  listingLabel,
  guestLabel,
}: {
  values: FilterValues;
  errors: FieldErrors;
  /** How many filters are on, for the badge on the button that opens this. */
  count: number;
  /**
   * Whether to offer the guest box. A guest's own scope is one person, so the filter can
   * only ever name themselves — it is the two roles that see other people's stays that
   * have a use for it. The box is what is withheld, not the filter: a `?guestId=` in the
   * URL is still parsed, still shown as a chip and still answered, because withholding
   * that would be a rule in the wrong place.
   */
  byGuest: boolean;
  /** The title of the listing being filtered by, where the page resolved it. */
  listingLabel: string | undefined;
  /** The address of the guest being filtered by, where the page resolved it. */
  guestLabel: string | undefined;
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
          <DialogTitle>Filter the stays</DialogTitle>
          <DialogDescription>
            A search is a link: whatever is applied here ends up in the address
            bar and can be sent to somebody else.
          </DialogDescription>
        </DialogHeader>

        {/*
          The fields are read as they were submitted rather than merged into the search on
          the screen, which is what a document submit did: a guest has no `guestId` box, so
          this form leaves that filter behind exactly as the browser would have.
        */}
        <FilterForm
          action={ROUTES.bookings}
          href={(fields) =>
            bookingsHref({
              status: fields.status ?? "",
              listingId: fields.listingId ?? "",
              guestId: fields.guestId ?? "",
              from: fields.from ?? "",
              to: fields.to ?? "",
              sort: fields.sort ?? "",
            })
          }
          onNavigate={() => setOpen(false)}
        >
          <div className="grid gap-4">
            <FilterSelect
              name="status"
              label="Status"
              anyLabel="Any status"
              options={statusOptions}
              value={values.status}
              error={errors.status}
            />

            <LookupField
              name="listingId"
              label="Listing"
              kind={LookupKind.listings}
              value={values.listingId}
              valueLabel={listingLabel}
              error={errors.listingId}
              placeholder="A title, or a listing's id"
              description="Any part of the title of a listing these stays were taken in, or its whole id."
            />

            {/*
              A window a stay has to touch rather than a bound on the check-in: both dates
              or neither, which is what the contract refuses half of.
            */}
            <FilterField
              name="from"
              label="Stays after"
              type="date"
              value={values.from}
              error={errors.from}
            />
            <FilterField
              name="to"
              label="Stays before"
              type="date"
              value={values.to}
              error={errors.to}
            />

            {byGuest && (
              <LookupField
                name="guestId"
                label="Guest"
                kind={LookupKind.guests}
                value={values.guestId}
                valueLabel={guestLabel}
                error={errors.guestId}
                placeholder="An address, or an account's id"
                description="Any part of the address of the guest who took the stay, or their whole id."
              />
            )}
          </div>

          {/*
            The ordering is not one of the boxes — it is the select in the toolbar — but
            this form still has to carry it: a form submits every field it has, and without
            this one showing the stays would put them back in the order they were taken.
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
