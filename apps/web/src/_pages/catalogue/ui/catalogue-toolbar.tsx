import type { FieldErrors } from "#shared/lib";
import { activeFilters, type FilterValues } from "../lib/catalogue-search";
import { ActiveFilters } from "./active-filters";
import { CatalogueFiltersDialog } from "./catalogue-filters-dialog";
import { CatalogueSort } from "./catalogue-sort";

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
  earliest,
}: {
  values: FilterValues;
  errors: FieldErrors;
  /**
   * Today in UTC, computed on the server. The date boxes refuse a stay in the past the
   * way `createBookingSchema` does, and reading the clock in the markup instead would
   * make the server and the browser disagree at midnight.
   */
  earliest: string;
}) => {
  // Everything except the ordering, which has a control of its own to sit under. Deduped
  // because a rule about a pair of fields is reported under each of them.
  const hidden = [
    ...new Set(
      Object.entries(errors)
        .filter(([field]) => field !== "sort")
        .flatMap(([, messages]) => messages),
    ),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <CatalogueFiltersDialog
          values={values}
          errors={errors}
          earliest={earliest}
          count={activeFilters(values).length}
        />

        <CatalogueSort values={values} error={errors.sort} />

        <ActiveFilters values={values} />
      </div>

      {hidden.map((message) => (
        <p key={message} className="text-sm text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
};
