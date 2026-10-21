"use client";

import { useEffect, useRef, useState, type UIEvent } from "react";
import {
  LOOKUP_MIN_LENGTH,
  type LookupKind,
  type StayParty,
} from "@repo/contracts";
import { lookupsApi } from "../../api";
import {
  firstPage,
  withNextPage,
  withoutNextPage,
  type LookupSearch,
} from "./lookup-search";

/** How long typing has to pause before the box asks — one request per word, not per letter. */
const DEBOUNCE_MS = 300;

/** A page of suggestions: more than the popup shows at once, so it can scroll before the next. */
const PAGE_SIZE = 20;

/** How close to the end of the list scrolling has to come before the next page is asked for. */
const LOAD_MORE_MARGIN_PX = 48;

/**
 * The suggestions of an id box (`LookupField`) for what is typed into it: one request per
 * pause, a keystroke aborting whatever the previous one was waiting for, the next page
 * included — and the list paged as it is scrolled, with the cursor the API handed back.
 *
 * `current` is the answer to `term` and nothing else: `null` while it is being asked for,
 * and never the answer to a term the box no longer holds. `side` is handed through to the
 * API, which reads it for the listings: the half of a user's stays the box filters.
 */
export function useLookupSearch(kind: LookupKind, side?: StayParty) {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState<LookupSearch | null>(null);

  /**
   * The next page in flight, and the guard against asking for it twice: two scroll events
   * can arrive before the render that would show `loadingMore`, and a ref is set at once.
   */
  const pageRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (term.length < LOOKUP_MIN_LENGTH) return;

    // A keystroke aborts the search in flight: the cleanup below runs before the next one.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      lookupsApi
        .page(kind, { q: term, limit: PAGE_SIZE, side }, controller.signal)
        .then((page) => setSearch(firstPage(term, page)))
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
  }, [kind, side, term]);

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

    lookupsApi
      .page(
        kind,
        { q: term, limit: PAGE_SIZE, cursor, side },
        controller.signal,
      )
      .then((page) =>
        setSearch((previous) => withNextPage(previous, term, cursor, page)),
      )
      .catch(() => setSearch((previous) => withoutNextPage(previous, term)))
      .finally(() => {
        if (pageRef.current === controller) pageRef.current = null;
      });
  };

  const onScroll = (event: UIEvent<HTMLElement>) => {
    const list = event.currentTarget;

    if (
      list.scrollHeight - list.scrollTop - list.clientHeight <
      LOAD_MORE_MARGIN_PX
    ) {
      loadMore();
    }
  };

  return { term, setTerm, current, onScroll };
}
