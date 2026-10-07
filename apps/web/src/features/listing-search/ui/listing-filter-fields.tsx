import type { FieldErrors } from "#shared/lib";
import { FilterField } from "#shared/ui";
import type { ListingFilterValues } from "../model/listing-filters";

/**
 * The boxes of `listingQuerySchema`, as the filter dialog of either listings screen draws
 * them — dates, prices and guests, two to a row in the grid the dialog puts them in. The
 * ordering is not one of them: it is the toolbar's select, carried by the form as a hidden
 * box of the dialog's own.
 */
export const ListingFilterFields = ({
  values,
  errors,
  earliest,
}: {
  values: ListingFilterValues;
  errors: FieldErrors;
  /** Today in UTC, from the server — see `shared/lib/dates.ts`. */
  earliest: string;
}) => (
  <>
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
  </>
);
