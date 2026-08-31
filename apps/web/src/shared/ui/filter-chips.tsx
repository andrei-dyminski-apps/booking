import Link from "next/link";
import { XIcon } from "lucide-react";
import { Badge } from "@repo/ui/components/badge";
import { ButtonLink } from "./button-link";

/** One filter that is on, and the address that is this same search without it. */
export type FilterChip = {
  key: string;
  label: string;
  href: string;
};

/**
 * What a list is currently being filtered by, and the way to take each of it off again.
 *
 * Every chip is a link to the same search without that filter, which is the whole trick:
 * the filters live in the address bar, so removing one is another address rather than a
 * piece of state somebody has to keep in step with the boxes. It needs no JavaScript, it
 * survives a reload, and the browser's Back button undoes it.
 *
 * Which filters those are, and what each of them is called, belongs to the screen that
 * knows what is being filtered — this draws them.
 */
export const FilterChips = ({
  filters,
  clearHref,
}: {
  filters: FilterChip[];
  /** The same search with nothing filtered, and the ordering left where the visitor put it. */
  clearHref: string;
}) => {
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

      <ButtonLink href={clearHref} variant="ghost" size="sm" className="h-7">
        Clear all
      </ButtonLink>
    </div>
  );
};
