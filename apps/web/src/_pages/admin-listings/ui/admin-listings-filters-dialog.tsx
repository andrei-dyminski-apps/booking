"use client";

import { LookupKind, type LookupOption } from "@repo/contracts";
import { ListingFilterFields } from "#features/listing-search";
import { ROUTES } from "#shared/config";
import type { FieldErrors } from "#shared/lib";
import { FiltersDialog, LookupField } from "#shared/ui";
import {
  adminListingsHref,
  clearedFiltersHref,
  type FilterValues,
} from "../lib/admin-listings-search";

/**
 * Every filter of the admin's listings, in the popup every list's filters are drawn in —
 * the catalogue's boxes plus the owner.
 */
export const AdminListingsFiltersDialog = ({
  values,
  errors,
  earliest,
  count,
  owner,
}: {
  values: FilterValues;
  errors: FieldErrors;
  /** Today in UTC, from the server — see `shared/lib/dates.ts`. */
  earliest: string;
  /** How many filters are on, for the badge on the button that opens this. */
  count: number;
  /** The owner, where the page resolved `ownerId` to an account. */
  owner: LookupOption | undefined;
}) => (
  <FiltersDialog
    title="Filter the listings"
    action={ROUTES.admin}
    href={(fields) =>
      adminListingsHref({
        ownerId: fields.ownerId ?? "",
        from: fields.from ?? "",
        to: fields.to ?? "",
        minPrice: fields.minPrice ?? "",
        maxPrice: fields.maxPrice ?? "",
        guests: fields.guests ?? "",
        sort: fields.sort ?? "",
      })
    }
    sort={values.sort}
    clearHref={clearedFiltersHref(values)}
    submitLabel="Show listings"
    count={count}
  >
    <LookupField
      name="ownerId"
      label="Owner"
      kind={LookupKind.owners}
      value={values.ownerId}
      valueOption={owner}
      error={errors.ownerId}
      placeholder="A name or an address, or an account's id"
      description="Any part of the owner's name or email, or the whole id from the address of their page."
    />
    <ListingFilterFields values={values} errors={errors} earliest={earliest} />
  </FiltersDialog>
);
