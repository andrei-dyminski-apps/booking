"use client";

import { useState } from "react";
import { SlidersHorizontalIcon } from "lucide-react";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import { roleOptions } from "#entities/user";
import { ROUTES } from "#shared/config";
import type { FieldErrors } from "#shared/lib";
import { ButtonLink, FilterField, FilterForm, FilterSelect } from "#shared/ui";
import {
  clearedFiltersHref,
  statusOptions,
  usersHref,
  type FilterValues,
} from "../lib/users-search";

/**
 * Every filter of the users screen, in a popup — the shape the catalogue's and the stays'
 * filters have, and for their reasons: a `GET` form that writes the search into the URL,
 * navigating to the canonical address itself where there is JavaScript.
 */
export const UsersFiltersDialog = ({
  values,
  errors,
  count,
}: {
  values: FilterValues;
  errors: FieldErrors;
  /** How many filters are on, for the badge on the button that opens this. */
  count: number;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontalIcon />
        Filters
        {count > 0 && (
          <Badge variant="default" className="ml-1">
            {count}
          </Badge>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Filter the users</DialogTitle>
          <DialogDescription>
            A search is a link: whatever is applied here ends up in the address
            bar.
          </DialogDescription>
        </DialogHeader>

        <FilterForm
          action={ROUTES.adminUsers}
          href={(fields) =>
            usersHref({
              role: fields.role ?? "",
              status: fields.status ?? "",
              email: fields.email ?? "",
              sort: fields.sort ?? "",
            })
          }
          onNavigate={() => setOpen(false)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FilterField
                name="email"
                label="Email"
                type="text"
                value={values.email}
                error={errors.email}
                description="Any part of it, in any case."
              />
            </div>

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
          </div>

          {/* The ordering is the toolbar's control, and this form still has to carry it. */}
          <input type="hidden" name="sort" defaultValue={values.sort} />

          <DialogFooter>
            <ButtonLink
              href={clearedFiltersHref(values)}
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Clear all
            </ButtonLink>
            <Button type="submit">Show users</Button>
          </DialogFooter>
        </FilterForm>
      </DialogContent>
    </Dialog>
  );
};
