"use client";

import { useState } from "react";
import {
  LOOKUP_MIN_LENGTH,
  type LookupKind,
  type LookupOption,
} from "@repo/contracts";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@repo/ui/components/combobox";
import { Field, FieldError } from "@repo/ui/components/field";
import { fieldMessages } from "../../lib";
import { HintLabel, hintOf } from "../hint-label";
import { type LookupSearch } from "./lookup-search";
import { useLookupSearch } from "./use-lookup-search";

/**
 * A box of a filter dialog that takes an id, filled in by name: three characters of a
 * person's name or a title are a search, a whole uuid is the one row it names, and what is
 * picked goes into the form as its id — so the URL, the contract and the chips are the ones
 * a typed id always had. The suggestions are the rows the filter can match for this
 * session, which is the API's to decide (`/lookups`) — an admin's search of accounts
 * matches the address too, and shows it under the name.
 *
 * **The id travels in a hidden input, not in the box.** The box holds the name a person
 * reads; the form submits what the filter means. Emptying the box empties the filter. Text
 * that is not the name of what was picked — a pasted id, a search nobody finished — is
 * submitted as it was typed, so the contract answers it under the box instead of the
 * filter quietly staying what it was; a value the URL arrived with but the contract
 * refused stays exactly as it was typed until it is replaced — the same rule every other
 * box of these dialogs keeps.
 *
 * **The list pages as it is scrolled.** Three letters can be half the site's accounts, so a
 * search answers twenty and the next twenty are asked for when the list nears its end, with
 * the cursor the API handed back. A keystroke aborts whatever the previous one was waiting
 * for, the next page included.
 *
 * It needs JavaScript, like the dialog it sits in — that is the trade the compact toolbar
 * already made (see "Search, filters and the URL" in `apps/web/CLAUDE.md`).
 */
export const LookupField = ({
  name,
  label,
  kind,
  value,
  valueOption,
  error,
  description,
  placeholder,
}: {
  name: string;
  label: string;
  kind: LookupKind;
  /** The id the URL carries, or the text it carries where the contract refused it. */
  value: string;
  /**
   * That row as the lookup offers it, which the page resolves on the server — once per
   * render, where the dialog this sits in mounts the box anew each time it opens. Without
   * one the box shows the id.
   */
  valueOption?: LookupOption | undefined;
  error: string[] | undefined;
  description?: string;
  placeholder: string;
}) => {
  const id = `filter-${name}`;
  const hint = hintOf(id, description);

  const [selected, setSelected] = useState<LookupOption | null>(
    value === ""
      ? null
      : (valueOption ?? { id: value, label: value, hint: null }),
  );
  const [inputValue, setInputValue] = useState(selected?.label ?? "");
  const { term, setTerm, current, onScroll } = useLookupSearch(kind);

  /** What was picked, while the box still shows its name rather than text typed over it. */
  const picked =
    selected !== null && inputValue === selected.label ? selected : null;

  const items =
    current?.status === "done"
      ? current.items
      : term === "" && selected !== null
        ? [selected]
        : [];

  return (
    <Field data-invalid={error !== undefined}>
      <HintLabel htmlFor={id} label={label} hint={hint} />

      <Combobox
        items={items}
        value={selected}
        onValueChange={setSelected}
        inputValue={inputValue}
        onInputValueChange={(next, { reason }) => {
          setInputValue(next);

          if (reason !== "input-change" && next !== "") return;

          setTerm(next.trim());
          // An emptied box is an emptied filter, not a search for nothing.
          if (next.trim() === "") setSelected(null);
        }}
        itemToStringLabel={(option: LookupOption) => option.label}
        isItemEqualToValue={(item: LookupOption, other: LookupOption) =>
          item.id === other.id
        }
        filter={null}
      >
        <ComboboxInput
          id={id}
          className="w-full"
          placeholder={placeholder}
          showTrigger={false}
          showClear={selected !== null}
          aria-invalid={error !== undefined}
          aria-describedby={hint?.id}
        />
        <ComboboxContent>
          <div
            role="status"
            className="px-2 py-1.5 text-sm text-muted-foreground empty:hidden"
          >
            {statusOf(term, current)}
          </div>
          <ComboboxList onScroll={onScroll}>
            {(option: LookupOption) => (
              <ComboboxItem key={option.id} value={option}>
                {/* Two rows of one name — two guests called the same — are told apart by
                    the hint where the API hands one over, and by the id where it does not. */}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{option.label}</span>
                  {option.hint !== null && (
                    <span className="truncate text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
                </span>
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                  {option.id.slice(0, 8)}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
          {current?.status === "done" && current.loadingMore && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              Loading more…
            </div>
          )}
        </ComboboxContent>
      </Combobox>

      {/* The box holds one line, so the hint of what was picked goes under it: a name alone
          would not say which of two people called the same the filter is about. */}
      {picked !== null && picked.hint !== null && (
        <p className="truncate text-xs text-muted-foreground">{picked.hint}</p>
      )}

      {/* What the filter means, as opposed to what the box shows — see above. */}
      <input
        type="hidden"
        name={name}
        value={picked !== null ? picked.id : inputValue.trim()}
      />

      <FieldError errors={fieldMessages(error)} />
    </Field>
  );
};

/**
 * What the popup says above its list, or nothing when the list speaks for itself. A
 * `role="status"`, so a screen reader hears a search run out or come back empty without
 * leaving the box.
 */
function statusOf(term: string, current: LookupSearch | null): string | null {
  if (term === "") return null;

  if (term.length < LOOKUP_MIN_LENGTH) {
    return `Type at least ${LOOKUP_MIN_LENGTH} characters of a name, or a whole id`;
  }

  if (current === null) return "Searching…";

  if (current.status === "failed")
    return "The search did not answer — try again";

  return current.items.length === 0 ? `Nothing matches “${term}”` : null;
}
