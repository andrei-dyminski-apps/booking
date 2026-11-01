import type { LookupOption } from "@repo/contracts";
import { FieldError } from "@repo/ui/components/field";
import type { SetAsideList } from "#shared/config";
import { fieldMessages, messagesExcept, type FieldErrors } from "#shared/lib";
import { FilterChips } from "#shared/ui";
import {
  clearedFiltersHref,
  type ActiveFilter,
  type FilterValues,
} from "../lib/payments-search";
import { PaymentsFiltersDialog } from "./payments-filters-dialog";

/**
 * The head of the tab's list: the button that opens every filter, and the chips — with
 * whatever the contract refused repeated out here, because the boxes it belongs to are
 * behind a closed door. No ordering: every list here is newest first and nothing else.
 */
export const PaymentsToolbar = ({
  list,
  values,
  errors,
  filters,
  listing,
  guest,
  host,
}: {
  list: SetAsideList;
  values: FilterValues;
  errors: FieldErrors;
  filters: ActiveFilter[];
  listing: LookupOption | undefined;
  guest: LookupOption | undefined;
  host: LookupOption | undefined;
}) => (
  <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <PaymentsFiltersDialog
        list={list}
        values={values}
        errors={errors}
        count={filters.length}
        listing={listing}
        guest={guest}
        host={host}
      />

      <FilterChips
        filters={filters}
        clearHref={clearedFiltersHref(list, values)}
      />
    </div>

    <FieldError errors={fieldMessages(messagesExcept(errors))} />
  </div>
);
