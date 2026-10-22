import { describe, expect, it } from "vitest";
import { StayParty } from "@repo/contracts";
import {
  readWaitlistSearch,
  sideOf,
  sideTabs,
  sortOptions,
  waitlistHref,
} from "./waitlist-search";

describe("readWaitlistSearch", () => {
  it("asks for the earliest check-ins first when the URL carries nothing", () => {
    const { query, errors, values } = readWaitlistSearch({});

    expect(query).toEqual({ limit: 20, sort: "checkInAsc" });
    expect(errors).toEqual({});
    expect(values).toEqual({ side: "", sort: "" });
  });

  it("carries the ordering and the cursor", () => {
    const { query } = readWaitlistSearch({ sort: "newest", cursor: "abc" });

    expect(query).toEqual({ limit: 20, sort: "newest", cursor: "abc" });
  });

  it("refuses an ordering nobody offers, under the box that takes it off", () => {
    const { query, errors } = readWaitlistSearch({ sort: "soonest" });

    expect(query).toBeNull();
    expect(errors.sort).toBeDefined();
  });
});

describe("sideOf", () => {
  it("reads anything but HOST as the caller's own ranges", () => {
    expect(sideOf({ side: "", sort: "" })).toBe(StayParty.GUEST);
    expect(sideOf({ side: "nonsense", sort: "" })).toBe(StayParty.GUEST);
    expect(sideOf({ side: "HOST", sort: "" })).toBe(StayParty.HOST);
  });
});

describe("sideTabs", () => {
  it("links each side with nothing else, and marks the current one", () => {
    expect(sideTabs({ side: "HOST", sort: "newest" })).toEqual([
      {
        side: StayParty.GUEST,
        label: "Waiting for",
        href: "/waitlist",
        current: false,
      },
      {
        side: StayParty.HOST,
        label: "On your listings",
        href: "/waitlist?side=HOST",
        current: true,
      },
    ]);
  });
});

describe("sortOptions", () => {
  it("leaves the default out of the URL and keeps the side", () => {
    expect(
      sortOptions({ side: "HOST", sort: "newest" }).map(
        ({ href, current }) => ({ href, current }),
      ),
    ).toEqual([
      { href: "/waitlist?side=HOST", current: false },
      { href: "/waitlist?side=HOST&sort=newest", current: true },
    ]);
  });
});

describe("waitlistHref", () => {
  it("appends the cursor last", () => {
    expect(waitlistHref({ side: "HOST", sort: "" }, "abc")).toBe(
      "/waitlist?side=HOST&cursor=abc",
    );
  });
});
