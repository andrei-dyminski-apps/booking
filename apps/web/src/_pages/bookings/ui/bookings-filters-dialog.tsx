"use client";

import { LookupKind, type LookupOption, type StayParty } from "@repo/contracts";
import { ROUTES } from "#shared/config";
import type { FieldErrors } from "#shared/lib";
import {
  FilterField,
  FiltersDialog,
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
 * Every filter the stays screen takes, in the popup every list's filters are drawn in
 * (`FiltersDialog`). A guest has no `guestId` box, so a submit leaves that filter behind
 * exactly as the browser would have.
 *
 * The two id boxes are filled in by name (`LookupField`): a part of a title or a name
 * is looked up among the listings and the guests of the stays this session may read, and
 * what is picked goes into the URL as the id it always was. The link on a card still fills
 * them in through the URL, and the box then shows the name of what it names.
 */
export const BookingsFiltersDialog = ({
  values,
  errors,
  count,
  side,
  byGuest,
  listing,
  guest,
}: {
  values: FilterValues;
  errors: FieldErrors;
  /** How many filters are on, for the badge on the button that opens this. */
  count: number;
  /**
   * The half of a user's stays being filtered, or `null` for an admin. It is carried by a
   * hidden box like the ordering — submitting the dialog stays on the tab it opened from —
   * and it scopes the listing box's suggestions to the same half.
   */
  side: StayParty | null;
  /**
   * Whether to offer the guest box. On the guest's side the scope is one person, so the
   * filter can only ever name themselves — it is a host and an admin, who see other
   * people's stays, that have a use for it. The box is what is withheld, not the filter:
   * a `?guestId=` in the URL is still parsed, still shown as a chip and still answered,
   * because withholding that would be a rule in the wrong place.
   */
  byGuest: boolean;
  /** The listing being filtered by, where the page resolved it. */
  listing: LookupOption | undefined;
  /** The guest being filtered by, where the page resolved them. */
  guest: LookupOption | undefined;
}) => (
  <FiltersDialog
    title="Filter the stays"
    description="A search is a link: whatever is applied here ends up in the address bar and can be sent to somebody else."
    action={ROUTES.bookings}
    href={(fields) =>
      bookingsHref({
        side: fields.side ?? "",
        status: fields.status ?? "",
        listingId: fields.listingId ?? "",
        guestId: fields.guestId ?? "",
        from: fields.from ?? "",
        to: fields.to ?? "",
        sort: fields.sort ?? "",
      })
    }
    sort={values.sort}
    clearHref={clearedFiltersHref(values)}
    submitLabel="Show stays"
    count={count}
  >
    <FilterSelect
      name="status"
      label="Status"
      anyLabel="Any status"
      options={statusOptions}
      value={values.status}
      error={errors.status}
    />

    {values.side !== "" && (
      <input type="hidden" name="side" defaultValue={values.side} />
    )}

    <LookupField
      name="listingId"
      label="Listing"
      kind={LookupKind.listings}
      side={side ?? undefined}
      value={values.listingId}
      valueOption={listing}
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
        valueOption={guest}
        error={errors.guestId}
        placeholder="A name, or an account's id"
        description="Any part of the name of the guest who took the stay, or their whole id."
      />
    )}
  </FiltersDialog>
);
