import { FieldError } from "@repo/ui/components/field";
import { fieldMessages, messagesExcept, type FieldErrors } from "#shared/lib";
import { FilterChips, SortSelect } from "#shared/ui";
import {
  clearedFiltersHref,
  sortOptions,
  type ActiveFilter,
  type FilterValues,
} from "../lib/catalogue-search";
import { CatalogueFiltersDialog } from "./catalogue-filters-dialog";

/**
 * The head of the catalogue: one row — the button that opens every filter, the ordering,
 * and what has been asked for so far as chips.
 *
 * Every box lives in the dialog now, so the screen above the list is two controls rather
 * than a panel of inputs: the filters are set once and then read back off the chips, each
 * of which is a link to the same search without it. The ordering is a box for the same
 * reason — four links only ever showed one answer at a time.
 *
 * The price of putting the boxes behind a door is that a refusal would be behind it too,
 * so whatever the contract said about a filter is repeated out here, next to the chip that
 * takes it off.
 */
export const CatalogueToolbar = ({
  values,
  errors,
  filters,
  earliest,
}: {
  values: FilterValues;
  errors: FieldErrors;
  /**
   * What is currently being filtered by, read once by the page: this row draws it as chips
   * and counts it on the button that opens the dialog, and the page asks the same list
   * whether there was a filter to blame for an empty result.
   */
  filters: ActiveFilter[];
  /**
   * Today in UTC, computed on the server. The date boxes refuse a stay in the past the
   * way `createBookingSchema` does, and reading the clock in the markup instead would
   * make the server and the browser disagree at midnight.
   */
  earliest: string;
}) => {
  // Everything the contract refused except the ordering, which has a control of its own to
  // sit under.
  const hidden = messagesExcept(errors, "sort");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <CatalogueFiltersDialog
          values={values}
          errors={errors}
          earliest={earliest}
          count={filters.length}
        />

        <SortSelect options={sortOptions(values)} error={errors.sort} />

        <FilterChips filters={filters} clearHref={clearedFiltersHref(values)} />
      </div>

      <FieldError errors={fieldMessages(hidden)} />
    </div>
  );
};
