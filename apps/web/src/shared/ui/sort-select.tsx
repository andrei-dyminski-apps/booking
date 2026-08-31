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

/**
 * One ordering, as a link: an ordering is another address, exactly like a filter. The
 * options themselves are written by the slice that knows what is being ordered — this only
 * draws them.
 */
export type SortOption = {
  value: string;
  label: string;
  href: string;
  current: boolean;
};

/**
 * How a list is ordered, as one box beside the filters. Both lists that page — the
 * catalogue and the stays — draw it, which is why it sits in `shared` rather than in
 * either of them; it is not a design-system primitive either, because navigating is the
 * whole of what it does and `useRouter` is how it does that.
 *
 * The ordering stays a value of the URL and nothing else: every option is a link the slice
 * wrote, so choosing one is a navigation to that address — it can be sent to somebody else,
 * and Back undoes it. Each of those links drops the cursor, and has to: the API issues one
 * under the ordering it was asked for and refuses it under another, so page four of the
 * newest stays is not a place in the earliest ones.
 *
 * What the box costs is the row of links it replaces and JavaScript, since a `<select>`
 * cannot navigate on its own. That is the same price the filters behind a dialog pay.
 */
export const SortSelect = ({
  options,
  error,
  label = "Sort by",
}: {
  options: SortOption[];
  /**
   * What the contract said about `sort`. It arrives out of a URL like every other value,
   * and there is no box for it — so a refusal is reported here, next to the control that
   * takes it off again.
   */
  error: string[] | undefined;
  label?: string;
}) => {
  const router = useRouter();
  const hrefs = new Map(options.map((option) => [option.value, option.href]));

  return (
    <div className="flex flex-col gap-1">
      <Select
        // Null rather than a value the contract refused: the parse has already refused the
        // search, and marking one of the options as chosen would state the opposite.
        value={options.find((option) => option.current)?.value ?? null}
        items={Object.fromEntries(
          options.map((option) => [option.value, option.label]),
        )}
        onValueChange={(value: string | null) => {
          const href = value === null ? undefined : hrefs.get(value);

          if (href !== undefined) router.push(href);
        }}
      >
        <SelectTrigger size="sm" aria-label={label}>
          <ArrowDownWideNarrowIcon className="size-3.5 text-muted-foreground" />
          <SelectValue placeholder={label} />
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
