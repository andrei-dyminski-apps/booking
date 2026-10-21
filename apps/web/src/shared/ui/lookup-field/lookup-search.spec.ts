import { describe, expect, it } from "vitest";
import type { LookupOption, LookupPage } from "@repo/contracts";
import {
  firstPage,
  withNextPage,
  withoutNextPage,
  type LookupSearch,
} from "./lookup-search";

const option = (id: string): LookupOption => ({ id, label: id, hint: null });

const page = (ids: string[], nextCursor: string | null): LookupPage => ({
  items: ids.map(option),
  nextCursor,
});

const loading = (search: LookupSearch): LookupSearch =>
  search.status === "done" ? { ...search, loadingMore: true } : search;

describe("withNextPage", () => {
  it("appends the page to the search that still ends at its cursor", () => {
    const previous = loading(firstPage("ann", page(["a", "b"], "c1")));

    expect(withNextPage(previous, "ann", "c1", page(["c"], "c2"))).toEqual({
      term: "ann",
      status: "done",
      items: [option("a"), option("b"), option("c")],
      nextCursor: "c2",
      loadingMore: false,
    });
  });

  it("drops the page when a fresh first page of the same term replaced the search", () => {
    const fresh = firstPage("ann", page(["a", "b"], "c9"));

    expect(withNextPage(fresh, "ann", "c1", page(["c"], "c2"))).toBe(fresh);
  });

  it("drops the page of a term the box no longer holds", () => {
    const other = loading(firstPage("bob", page(["x"], "c1")));

    expect(withNextPage(other, "ann", "c1", page(["c"], "c2"))).toBe(other);
  });

  it("drops the page when the search failed meanwhile", () => {
    const failed: LookupSearch = { term: "ann", status: "failed" };

    expect(withNextPage(failed, "ann", "c1", page(["c"], null))).toBe(failed);
  });

  it("drops the page when there is no search at all", () => {
    expect(withNextPage(null, "ann", "c1", page(["c"], null))).toBeNull();
  });
});

describe("withoutNextPage", () => {
  it("stops loading and keeps the cursor, so scrolling asks again", () => {
    const previous = loading(firstPage("ann", page(["a"], "c1")));

    expect(withoutNextPage(previous, "ann")).toEqual({
      term: "ann",
      status: "done",
      items: [option("a")],
      nextCursor: "c1",
      loadingMore: false,
    });
  });

  it("leaves a search of another term alone", () => {
    const other = loading(firstPage("bob", page(["x"], "c1")));

    expect(withoutNextPage(other, "ann")).toBe(other);
  });
});
