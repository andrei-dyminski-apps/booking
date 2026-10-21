"use client";

import { ListingFilterFields } from "#features/listing-search";
import { ROUTES } from "#shared/config";
import type { FieldErrors } from "#shared/lib";
import { FiltersDialog } from "#shared/ui";
import {
  catalogueHref,
  clearedFiltersHref,
  type FilterValues,
} from "../lib/catalogue-search";

/**
 * Every filter the catalogue takes, in the popup every list's filters are drawn in
 * (`FiltersDialog`). The link it goes to is written by `catalogueHref`, the same function
 * the chips and the ordering use.
 *
 * The boxes are all behind it, so a visitor whose scripts never arrive cannot ask a
 * question of their own any more — what they can still do is read the catalogue and take a
 * filter off a search somebody sent them, because a chip is a link. That is the trade the
 * compact toolbar is: the screen above the list is two controls rather than a panel.
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
  <FiltersDialog
    title="Filter the catalogue"
    description="A search is a link: whatever is applied here ends up in the address bar and can be sent to somebody else."
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
    sort={values.sort}
    clearHref={clearedFiltersHref(values)}
    submitLabel="Show stays"
    count={count}
  >
    <ListingFilterFields values={values} errors={errors} earliest={earliest} />
  </FiltersDialog>
);
