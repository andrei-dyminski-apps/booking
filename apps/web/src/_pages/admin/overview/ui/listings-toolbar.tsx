import type { LookupOption } from "@repo/contracts";
import { FieldError } from "@repo/ui/components/field";
import { fieldMessages, messagesExcept, type FieldErrors } from "#shared/lib";
import { FilterChips, SortSelect } from "#shared/ui";
import {
  clearedFiltersHref,
  sortOptions,
  type ActiveFilter,
  type FilterValues,
} from "../lib/listings-search";
import { ListingsFiltersDialog } from "./listings-filters-dialog";

/**
 * The head of the admin's listings: the button that opens every filter, the ordering, and
 * the chips — with whatever the contract refused repeated out here, because the boxes it
 * belongs to are behind a closed door.
 */
export const ListingsToolbar = ({
  values,
  errors,
  filters,
  earliest,
  owner,
}: {
  values: FilterValues;
  errors: FieldErrors;
  filters: ActiveFilter[];
  /** Today in UTC, computed on the server — see `CatalogueToolbar`. */
  earliest: string;
  /** The owner being filtered by, for the box that names them — see the dialog. */
  owner: LookupOption | undefined;
}) => {
  const hidden = messagesExcept(errors, "sort");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ListingsFiltersDialog
          values={values}
          errors={errors}
          earliest={earliest}
          count={filters.length}
          owner={owner}
        />

        <SortSelect options={sortOptions(values)} error={errors.sort} />

        <FilterChips filters={filters} clearHref={clearedFiltersHref(values)} />
      </div>

      <FieldError errors={fieldMessages(hidden)} />
    </div>
  );
};
