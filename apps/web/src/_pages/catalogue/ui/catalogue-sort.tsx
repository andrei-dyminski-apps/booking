"use client";

import { useRouter } from "next/navigation";
import { ArrowDownWideNarrowIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import type { ListingSort } from "@repo/contracts";
import { sortOptions, type FilterValues } from "../lib/catalogue-search";

/**
 * How the list is ordered, as one box beside the "Filters" button.
 *
 * The ordering is still a value of the URL and nothing else: every option here is the
 * link `sortOptions` writes, so choosing one is a navigation to that address — it can be
 * sent to somebody else, and Back undoes it. Each of those links drops the cursor, and it
 * has to: the API issues one under the ordering it was asked for and refuses it under
 * another, so page four of the newest stays is not a place in the cheapest ones.
 *
 * What the box costs is the row of links it replaces — four buttons that only ever showed
 * one answer at a time — and JavaScript, since a `<select>` cannot navigate on its own.
 * That is the same price the filters behind the dialog already pay.
 */
export const CatalogueSort = ({
  values,
  error,
}: {
  values: FilterValues;
  /**
   * What the contract said about `sort`. It arrives out of a URL like every other value,
   * and there is no box for it — so a refusal is reported here, next to the control that
   * takes it off again.
   */
  error: string[] | undefined;
}) => {
  const router = useRouter();
  const options = sortOptions(values);
  const hrefs = new Map(options.map((option) => [option.value, option.href]));

  return (
    <div className="flex flex-col gap-1">
      <Select
        // Null rather than a value the contract refused: the parse has already refused the
        // search, and marking one of the four as chosen would state the opposite.
        value={options.find((option) => option.current)?.value ?? null}
        items={Object.fromEntries(
          options.map((option) => [option.value, option.label]),
        )}
        onValueChange={(value: ListingSort | null) => {
          const href = value === null ? undefined : hrefs.get(value);

          if (href !== undefined) router.push(href);
        }}
      >
        <SelectTrigger size="sm" aria-label="Sort by">
          <ArrowDownWideNarrowIcon className="size-3.5 text-muted-foreground" />
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>

        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(error ?? []).map((message) => (
        <p key={message} className="text-sm text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
};
