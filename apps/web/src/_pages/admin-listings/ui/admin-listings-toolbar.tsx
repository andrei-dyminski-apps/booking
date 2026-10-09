import { FieldError } from "@repo/ui/components/field";
import { fieldMessages, messagesExcept, type FieldErrors } from "#shared/lib";
import { FilterChips, SortSelect } from "#shared/ui";
import {
  clearedFiltersHref,
  sortOptions,
  type ActiveFilter,
  type FilterValues,
} from "../lib/admin-listings-search";
import { AdminListingsFiltersDialog } from "./admin-listings-filters-dialog";

/**
 * The head of the admin's listings: the button that opens every filter, the ordering, and
 * the chips — with whatever the contract refused repeated out here, because the boxes it
 * belongs to are behind a closed door.
 */
export const AdminListingsToolbar = ({
  values,
  errors,
  filters,
  earliest,
  ownerLabel,
}: {
  values: FilterValues;
  errors: FieldErrors;
  filters: ActiveFilter[];
  /** Today in UTC, computed on the server — see `CatalogueToolbar`. */
  earliest: string;
  /** The owner's address, for the box that names them — see the dialog. */
  ownerLabel: string | undefined;
}) => {
  const hidden = messagesExcept(errors, "sort");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <AdminListingsFiltersDialog
          values={values}
          errors={errors}
          earliest={earliest}
          count={filters.length}
          ownerLabel={ownerLabel}
        />

        <SortSelect options={sortOptions(values)} error={errors.sort} />

        <FilterChips filters={filters} clearHref={clearedFiltersHref(values)} />
      </div>

      <FieldError errors={fieldMessages(hidden)} />
    </div>
  );
};
