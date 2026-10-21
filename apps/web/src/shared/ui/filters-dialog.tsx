"use client";

import { useState, type ReactNode } from "react";
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
import { ButtonLink } from "./button-link";
import { FilterForm } from "./filter-form";

/**
 * Every filter of a list, in a popup — the shell each list's dialog is drawn in, so the
 * slice only says which boxes it has and where they lead. The form inside is
 * `FilterForm`: a `GET` form that writes the search into the URL, navigating to the
 * canonical address itself where there is JavaScript.
 *
 * The dialog is open state and nothing else, and it is here because the navigation is a
 * client one: a document navigation used to take the popup with it, and a soft one leaves
 * it standing. Both ways out of it — the submit and "Clear all" — close it for that reason.
 *
 * The fields are read as they were submitted rather than merged into the search on the
 * screen: a form carries what it carries, so a filter with no box here — and the cursor,
 * which never has one — is left behind exactly as a document submit would leave it.
 */
export const FiltersDialog = ({
  title,
  description = "A search is a link: whatever is applied here ends up in the address bar.",
  action,
  href,
  sort,
  clearHref,
  submitLabel,
  count,
  children,
}: {
  title: string;
  /** The line under the title; a public list adds that its link can be sent on. */
  description?: string;
  /** The route of the list, where the form posts without JavaScript. */
  action: string;
  /** The canonical address of the submitted fields — see `FilterForm`. */
  href: (fields: Record<string, string>) => string;
  /**
   * The ordering on the screen. It is the toolbar's control rather than one of the boxes,
   * but the form still has to carry it: a form submits every field it has, and without
   * this one the list would fall back to its default order.
   */
  sort: string;
  /** The same search with every filter taken off. */
  clearHref: string;
  submitLabel: string;
  /** How many filters are on, for the badge on the button that opens this. */
  count: number;
  /** The boxes. */
  children: ReactNode;
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <FilterForm
          action={action}
          href={href}
          onNavigate={() => setOpen(false)}
        >
          <div className="grid gap-4">{children}</div>

          <input type="hidden" name="sort" defaultValue={sort} />

          <DialogFooter>
            {/*
              It closes the dialog like the submit beside it: the boxes are uncontrolled,
              so a soft navigation that left the popup standing would leave them holding
              the filters this link has just taken off.
            */}
            <ButtonLink
              href={clearHref}
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Clear all
            </ButtonLink>
            <Button type="submit">{submitLabel}</Button>
          </DialogFooter>
        </FilterForm>
      </DialogContent>
    </Dialog>
  );
};
