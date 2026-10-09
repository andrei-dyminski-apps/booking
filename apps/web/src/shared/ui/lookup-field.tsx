"use client";

import { useEffect, useRef, useState, type UIEvent } from "react";
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
import { lookupsApi } from "../api";
import { fieldMessages } from "../lib";
import { FilterLabel, filterHint } from "./filter-label";

/** How long typing has to pause before the box asks — one request per word, not per letter. */
const DEBOUNCE_MS = 300;

/** A page of suggestions: more than the popup shows at once, so it can scroll before the next. */
const PAGE_SIZE = 20;

/** How close to the end of the list scrolling has to come before the next page is asked for. */
const LOAD_MORE_MARGIN_PX = 48;

/** The answer to one search, tagged with what was searched so a stale one is never shown. */
type Search =
  | { term: string; status: "failed" }
  | {
      term: string;
      status: "done";
      items: LookupOption[];
      nextCursor: string | null;
      loadingMore: boolean;
    };

/**
 * A box of a filter dialog that takes an id, filled in by name: three characters of an
 * address or a title are a search, a whole uuid is the one row it names, and what is picked
 * goes into the form as its id — so the URL, the contract and the chips are the ones a typed
 * id always had. The suggestions are the rows the filter can match for this session, which
 * is the API's to decide (`/lookups`).
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
  valueLabel,
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
   * The name of that row, which the page resolves on the server — once per render, where
   * the dialog this sits in mounts the box anew each time it opens. Without one the box
   * shows the id.
   */
  valueLabel?: string | undefined;
  error: string[] | undefined;
  description?: string;
  placeholder: string;
}) => {
  const id = `filter-${name}`;
  const hint = filterHint(id, description);

  const [selected, setSelected] = useState<LookupOption | null>(
    value === "" ? null : { id: value, label: valueLabel ?? value },
  );
  const [inputValue, setInputValue] = useState(selected?.label ?? "");
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState<Search | null>(null);

  /** The search in flight: a keystroke aborts it. */
  const searchRef = useRef<AbortController | null>(null);
  /**
   * The next page in flight, and the guard against asking for it twice: two scroll events
   * can arrive before the render that would show `loadingMore`, and a ref is set at once.
   */
  const pageRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (term.length < LOOKUP_MIN_LENGTH) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchRef.current?.abort();
      searchRef.current = controller;

      lookupsApi
        .page(kind, { q: term, limit: PAGE_SIZE }, controller.signal)
        .then(({ items, nextCursor }) =>
          setSearch({
            term,
            status: "done",
            items,
            nextCursor,
            loadingMore: false,
          }),
        )
        .catch(() => {
          if (!controller.signal.aborted) setSearch({ term, status: "failed" });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
      // The next page of the old search is as worthless as the search itself.
      pageRef.current?.abort();
      pageRef.current = null;
    };
  }, [kind, term]);

  const current = search !== null && search.term === term ? search : null;

  const loadMore = () => {
    if (
      current?.status !== "done" ||
      current.nextCursor === null ||
      pageRef.current !== null
    ) {
      return;
    }

    const cursor = current.nextCursor;
    const controller = new AbortController();

    pageRef.current = controller;
    setSearch({ ...current, loadingMore: true });

    // Both answers land on whatever the search is by then, and only while it still ends
    // at this cursor: a fresh first page of the same term may have replaced it meanwhile.
    lookupsApi
      .page(kind, { q: term, limit: PAGE_SIZE, cursor }, controller.signal)
      .then(({ items, nextCursor }) =>
        setSearch((previous) =>
          previous?.status === "done" &&
          previous.term === term &&
          previous.nextCursor === cursor
            ? {
                ...previous,
                items: [...previous.items, ...items],
                nextCursor,
                loadingMore: false,
              }
            : previous,
        ),
      )
      .catch(() =>
        // Leaves the cursor where it was, so scrolling again asks again — aborted or failed.
        setSearch((previous) =>
          previous?.status === "done" && previous.term === term
            ? { ...previous, loadingMore: false }
            : previous,
        ),
      )
      .finally(() => {
        if (pageRef.current === controller) pageRef.current = null;
      });
  };

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const list = event.currentTarget;

    if (
      list.scrollHeight - list.scrollTop - list.clientHeight <
      LOAD_MORE_MARGIN_PX
    ) {
      loadMore();
    }
  };

  const items =
    current?.status === "done"
      ? current.items
      : term === "" && selected !== null
        ? [selected]
        : [];

  return (
    <Field data-invalid={error !== undefined}>
      <FilterLabel htmlFor={id} label={label} hint={hint} />

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
                <span className="truncate">{option.label}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
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

      {/* What the filter means, as opposed to what the box shows — see above. */}
      <input
        type="hidden"
        name={name}
        value={
          selected !== null && inputValue === selected.label
            ? selected.id
            : inputValue.trim()
        }
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
function statusOf(term: string, current: Search | null): string | null {
  if (term === "") return null;

  if (term.length < LOOKUP_MIN_LENGTH) {
    return `Type at least ${LOOKUP_MIN_LENGTH} characters of a name, or a whole id`;
  }

  if (current === null) return "Searching…";

  if (current.status === "failed")
    return "The search did not answer — try again";

  return current.items.length === 0 ? `Nothing matches “${term}”` : null;
}
