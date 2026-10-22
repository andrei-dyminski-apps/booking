"use client";

import { roleOptions } from "#entities/user";
import { ROUTES } from "#shared/config";
import type { FieldErrors } from "#shared/lib";
import { FilterField, FiltersDialog, FilterSelect } from "#shared/ui";
import {
  clearedFiltersHref,
  statusOptions,
  usersHref,
  type FilterValues,
} from "../lib/users-search";

/** Every filter of the users screen, in the popup every list's filters are drawn in. */
export const UsersFiltersDialog = ({
  values,
  errors,
  count,
}: {
  values: FilterValues;
  errors: FieldErrors;
  /** How many filters are on, for the badge on the button that opens this. */
  count: number;
}) => (
  <FiltersDialog
    title="Filter the users"
    action={ROUTES.adminUsers}
    href={(fields) =>
      usersHref({
        role: fields.role ?? "",
        status: fields.status ?? "",
        name: fields.name ?? "",
        email: fields.email ?? "",
        sort: fields.sort ?? "",
      })
    }
    sort={values.sort}
    clearHref={clearedFiltersHref(values)}
    submitLabel="Show users"
    count={count}
  >
    <FilterField
      name="name"
      label="Name"
      type="text"
      value={values.name}
      error={errors.name}
      description="Any part of it, in any case."
    />

    <FilterField
      name="email"
      label="Email"
      type="text"
      value={values.email}
      error={errors.email}
      description="Any part of it, in any case."
    />

    <FilterSelect
      name="role"
      label="Role"
      anyLabel="Any role"
      options={roleOptions}
      value={values.role}
      error={errors.role}
    />

    <FilterSelect
      name="status"
      label="Status"
      anyLabel="Any status"
      options={statusOptions}
      value={values.status}
      error={errors.status}
    />
  </FiltersDialog>
);
