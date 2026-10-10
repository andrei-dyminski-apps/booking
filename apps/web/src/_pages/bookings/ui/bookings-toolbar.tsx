import type { LookupOption } from "@repo/contracts";
import { FieldError } from "@repo/ui/components/field";
import { fieldMessages, messagesExcept, type FieldErrors } from "#shared/lib";
import { FilterChips, SortSelect } from "#shared/ui";
import {
  clearedFiltersHref,
  sortOptions,
  type ActiveFilter,
  type FilterValues,
} from "../lib/bookings-search";
import { BookingsFiltersDialog } from "./bookings-filters-dialog";

/**
 * The head of the stays screen: one row — the button that opens every filter, the
 * ordering, and what has been asked for so far as chips.
 *
 * The price of putting the boxes behind a door is that a refusal would be behind it too,
 * so whatever the contract said about a filter is repeated out here, next to the chip that
 * takes it off.
 */
export const BookingsToolbar = ({
  values,
  errors,
  filters,
  byGuest,
  listing,
  guest,
}: {
  values: FilterValues;
  errors: FieldErrors;
  /**
   * What is currently being filtered by, read once by the page: this row draws it as chips
   * and counts it on the button that opens the dialog, and the page asks the same list
   * whether there was a filter to blame for an empty result. It arrives already carrying
   * the names of the listing and the guest where the page resolved them — an id in a chip is
   * something a visitor can only recognise, a name is something they can read.
   */
  filters: ActiveFilter[];
  /** Whether this role has a use for the guest box — see the dialog. */
  byGuest: boolean;
  /** The listing being filtered by, for the box that names it. */
  listing: LookupOption | undefined;
  /** The guest being filtered by, for the box that names them. */
  guest: LookupOption | undefined;
}) => {
  // Everything the contract refused except the ordering, which has a control of its own to
  // sit under.
  const hidden = messagesExcept(errors, "sort");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <BookingsFiltersDialog
          values={values}
          errors={errors}
          count={filters.length}
          byGuest={byGuest}
          listing={listing}
          guest={guest}
        />

        <SortSelect options={sortOptions(values)} error={errors.sort} />

        <FilterChips filters={filters} clearHref={clearedFiltersHref(values)} />
      </div>

      <FieldError errors={fieldMessages(hidden)} />
    </div>
  );
};
