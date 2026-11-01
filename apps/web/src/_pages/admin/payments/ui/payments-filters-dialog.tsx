"use client";

import { LookupKind, type LookupOption } from "@repo/contracts";
import { ROUTES, setAsideHref, type SetAsideList } from "#shared/config";
import type { FieldErrors } from "#shared/lib";
import { FilterField, FiltersDialog, LookupField } from "#shared/ui";
import {
  clearedFiltersHref,
  LIST_LABELS,
  type FilterValues,
} from "../lib/payments-search";

/**
 * Every filter of the tab on the screen, in the popup every list's filters are drawn in.
 * The tab and the half of the bounced refunds travel as hidden boxes, so a submit stays
 * where it was opened. The events are found by their own id and type; a bounced refund or
 * a stuck stay by the stay it belongs to, and the people and the listing of that stay —
 * filled in by name, as on the stays screen.
 */
export const PaymentsFiltersDialog = ({
  list,
  values,
  errors,
  count,
  listing,
  guest,
  host,
}: {
  list: SetAsideList;
  values: FilterValues;
  errors: FieldErrors;
  /** How many filters are on, for the badge on the button that opens this. */
  count: number;
  listing: LookupOption | undefined;
  guest: LookupOption | undefined;
  host: LookupOption | undefined;
}) => (
  <FiltersDialog
    title={`Filter the ${LIST_LABELS[list].toLowerCase()}`}
    action={ROUTES.adminPayments}
    href={(fields) =>
      setAsideHref(list, {
        status: fields.status ?? "",
        eventId: fields.eventId ?? "",
        type: fields.type ?? "",
        refundId: fields.refundId ?? "",
        paymentId: fields.paymentId ?? "",
        bookingId: fields.bookingId ?? "",
        listingId: fields.listingId ?? "",
        guestId: fields.guestId ?? "",
        hostId: fields.hostId ?? "",
        from: fields.from ?? "",
        to: fields.to ?? "",
      })
    }
    clearHref={clearedFiltersHref(list, values)}
    submitLabel="Show results"
    count={count}
  >
    <input type="hidden" name="list" defaultValue={list} />
    {values.status !== "" && (
      <input type="hidden" name="status" defaultValue={values.status} />
    )}

    {list === "events" ? (
      <>
        <FilterField
          name="eventId"
          label="Event id"
          type="text"
          value={values.eventId}
          error={errors.eventId}
          description="The provider's whole id, evt_…, as a notice names it."
        />
        <FilterField
          name="type"
          label="Event type"
          type="text"
          value={values.type}
          error={errors.type}
          description="Any part of it, in any case: dispute finds both dispute events."
        />
      </>
    ) : (
      <>
        {list === "bounced" && (
          <>
            <FilterField
              name="refundId"
              label="Refund id"
              type="text"
              value={values.refundId}
              error={errors.refundId}
              description="The provider's whole id, re_…, as a notice names it."
            />
            <FilterField
              name="paymentId"
              label="Payment id"
              type="text"
              value={values.paymentId}
              error={errors.paymentId}
              description="The whole id of the payment the refund was made from, pi_…."
            />
          </>
        )}

        <FilterField
          name="bookingId"
          label="Stay id"
          type="text"
          value={values.bookingId}
          error={errors.bookingId}
          description="The whole id from the address of the stay's page."
        />

        <LookupField
          name="listingId"
          label="Listing"
          kind={LookupKind.listings}
          value={values.listingId}
          valueOption={listing}
          error={errors.listingId}
          placeholder="A title, or a listing's id"
          description="Any part of the title of the listing the stay was taken in, or its whole id."
        />

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

        <LookupField
          name="hostId"
          label="Host"
          kind={LookupKind.hosts}
          value={values.hostId}
          valueOption={host}
          error={errors.hostId}
          placeholder="A name or an address, or an account's id"
          description="Any part of the name or email of the listing's owner, or their whole id."
        />
      </>
    )}

    {/* Either end alone is a question of its own: since a day, or up to one. */}
    <FilterField
      name="from"
      label="Set aside from"
      type="date"
      value={values.from}
      error={errors.from}
    />
    <FilterField
      name="to"
      label="Set aside until"
      type="date"
      value={values.to}
      error={errors.to}
    />
  </FiltersDialog>
);
