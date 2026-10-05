import { describe, expect, it } from "vitest";
import {
  activeFilters,
  clearedFiltersHref,
  readUsersSearch,
  sortOptions,
  usersHref,
} from "./users-search";

const NO_FILTERS = { role: "", status: "", email: "", sort: "" };

describe("readUsersSearch", () => {
  it("asks the unfiltered question when the URL carries nothing", () => {
    const { query, errors, values, canonical } = readUsersSearch({});

    expect(query).toEqual({ limit: 20, sort: "newest" });
    expect(errors).toEqual({});
    expect(values).toEqual(NO_FILTERS);
    expect(canonical).toBeNull();
  });

  it("carries the filters the contract takes, the address lower-cased", () => {
    const { query } = readUsersSearch({
      role: "OWNER",
      status: "BLOCKED",
      email: "Smith@",
      sort: "oldest",
    });

    expect(query).toEqual({
      limit: 20,
      role: "OWNER",
      status: "BLOCKED",
      email: "smith@",
      sort: "oldest",
    });
  });

  it("refuses a role nobody has, and keeps what was typed for the chip", () => {
    const { query, errors, values } = readUsersSearch({ role: "SUPERUSER" });

    expect(query).toBeNull();
    expect(errors.role).toHaveLength(1);
    expect(values.role).toBe("SUPERUSER");
    expect(activeFilters(values)).toEqual([
      { key: "role", label: "SUPERUSER", href: "/admin/users" },
    ]);
  });

  it("reads a parameter repeated in the URL as no filter at all", () => {
    expect(readUsersSearch({ role: ["USER", "ADMIN"] }).query).toEqual({
      limit: 20,
      sort: "newest",
    });
  });

  it("redirects what a GET form submits to the address the chips write", () => {
    const { canonical } = readUsersSearch({
      role: "",
      status: "BLOCKED",
      email: "",
      sort: "",
    });

    expect(canonical).toBe("/admin/users?status=BLOCKED");
  });

  it("leaves the canonical address alone — a redirect that is not a fixed point loops", () => {
    const href = usersHref(
      { role: "ADMIN", status: "", email: "a@b", sort: "oldest" },
      "cursor-value",
    );
    const params = Object.fromEntries(
      new URL(href, "http://localhost").searchParams,
    );

    expect(readUsersSearch(params).canonical).toBeNull();
  });

  it("drops a parameter this list does not take", () => {
    expect(readUsersSearch({ utm_source: "mail" }).canonical).toBe(
      "/admin/users",
    );
  });
});

describe("activeFilters", () => {
  it("takes each filter off on its own and keeps the ordering", () => {
    const values = {
      role: "OWNER",
      status: "ACTIVE",
      email: "smith",
      sort: "oldest",
    };

    expect(activeFilters(values)).toEqual([
      {
        key: "role",
        label: "Owner",
        href: "/admin/users?status=ACTIVE&email=smith&sort=oldest",
      },
      {
        key: "status",
        label: "Active",
        href: "/admin/users?role=OWNER&email=smith&sort=oldest",
      },
      {
        key: "email",
        label: "Address has “smith”",
        href: "/admin/users?role=OWNER&status=ACTIVE&sort=oldest",
      },
    ]);
    expect(clearedFiltersHref(values)).toBe("/admin/users?sort=oldest");
  });
});

describe("sortOptions", () => {
  it("writes the default as the bare address and drops the cursor of every option", () => {
    const options = sortOptions({ ...NO_FILTERS, role: "USER" });

    expect(options).toEqual([
      {
        value: "newest",
        label: "Joined most recently",
        href: "/admin/users?role=USER",
        current: true,
      },
      {
        value: "oldest",
        label: "Joined first",
        href: "/admin/users?role=USER&sort=oldest",
        current: false,
      },
    ]);
  });

  it("marks nothing as chosen when the ordering in the URL was refused", () => {
    expect(
      sortOptions({ ...NO_FILTERS, sort: "byEmail" }).some(
        (option) => option.current,
      ),
    ).toBe(false);
  });
});
