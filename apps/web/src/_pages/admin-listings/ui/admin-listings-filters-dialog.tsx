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
import { ListingFilterFields } from "#features/listing-search";
import { ROUTES } from "#shared/config";
import type { FieldErrors } from "#shared/lib";
import { ButtonLink, FilterField, FilterForm } from "#shared/ui";
import {
  adminListingsHref,
  clearedFiltersHref,
  type FilterValues,
} from "../lib/admin-listings-search";

/**
 * Every filter of the admin's listings, in a popup — the catalogue's boxes plus the owner,
 * and the shape every other filter dialog has: a `GET` form that writes the search into
 * the URL, navigating to the canonical address itself where there is JavaScript.
 */
export const AdminListingsFiltersDialog = ({
  values,
  errors,
  earliest,
  count,
}: {
  values: FilterValues;
  errors: FieldErrors;
  /** Today in UTC, from the server — see `shared/lib/dates.ts`. */
  earliest: string;
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
          <DialogTitle>Filter the listings</DialogTitle>
          <DialogDescription>
            A search is a link: whatever is applied here ends up in the address
            bar.
          </DialogDescription>
        </DialogHeader>

        <FilterForm
          action={ROUTES.admin}
          href={(fields) =>
            adminListingsHref({
              ownerId: fields.ownerId ?? "",
              from: fields.from ?? "",
              to: fields.to ?? "",
              minPrice: fields.minPrice ?? "",
              maxPrice: fields.maxPrice ?? "",
              guests: fields.guests ?? "",
              sort: fields.sort ?? "",
            })
          }
          onNavigate={() => setOpen(false)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FilterField
                name="ownerId"
                label="Owner"
                type="text"
                value={values.ownerId}
                error={errors.ownerId}
                description="The id from the address of an account's page."
              />
            </div>
            <ListingFilterFields
              values={values}
              errors={errors}
              earliest={earliest}
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
            <Button type="submit">Show listings</Button>
          </DialogFooter>
        </FilterForm>
      </DialogContent>
    </Dialog>
  );
};
