import Link from "next/link";
import { XIcon } from "lucide-react";
import { Badge } from "@repo/ui/components/badge";
import { buttonVariants } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";
import {
  activeFilters,
  clearedFiltersHref,
  type FilterValues,
} from "../lib/catalogue-search";

/**
 * What is currently being filtered by, and the way to take each of it off again.
 *
 * Every chip is a link to the same search without that filter, which is the whole trick:
 * the filters live in the address bar, so removing one is another address rather than a
 * piece of state somebody has to keep in step with the boxes. It needs no JavaScript, it
 * survives a reload, and the browser's Back button undoes it.
 */
export const ActiveFilters = ({ values }: { values: FilterValues }) => {
  const filters = activeFilters(values);

  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <Badge
          key={filter.key}
          variant="secondary"
          className="h-7 gap-1 pr-1 pl-2.5"
          render={<Link href={filter.href} />}
        >
          {filter.label}
          <span
            aria-hidden
            className="grid size-4 place-items-center rounded-full bg-foreground/10"
          >
            <XIcon className="size-2.5" />
          </span>
          <span className="sr-only">— remove this filter</span>
        </Badge>
      ))}

      <Link
        href={clearedFiltersHref(values)}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7")}
      >
        Clear all
      </Link>
    </div>
  );
};
