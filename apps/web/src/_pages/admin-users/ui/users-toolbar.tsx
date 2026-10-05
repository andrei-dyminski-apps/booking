import { messagesExcept, type FieldErrors } from "#shared/lib";
import { FilterChips, SortSelect } from "#shared/ui";
import {
  clearedFiltersHref,
  sortOptions,
  type ActiveFilter,
  type FilterValues,
} from "../lib/users-search";
import { UsersFiltersDialog } from "./users-filters-dialog";

/**
 * The head of the users screen: the button that opens every filter, the ordering, and the
 * chips — with whatever the contract refused repeated out here, because the boxes it
 * belongs to are behind a closed door.
 */
export const UsersToolbar = ({
  values,
  errors,
  filters,
}: {
  values: FilterValues;
  errors: FieldErrors;
  filters: ActiveFilter[];
}) => {
  const hidden = messagesExcept(errors, "sort");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <UsersFiltersDialog
          values={values}
          errors={errors}
          count={filters.length}
        />

        <SortSelect options={sortOptions(values)} error={errors.sort} />

        <FilterChips filters={filters} clearHref={clearedFiltersHref(values)} />
      </div>

      {hidden.map((message) => (
        <p key={message} className="text-sm text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
};
