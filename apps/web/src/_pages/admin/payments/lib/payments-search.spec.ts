import { describe, expect, it } from "vitest";
import { setAsideHref } from "#shared/config";
import {
  activeFilters,
  clearedFiltersHref,
  firstPageHref,
  listTabs,
  nextPageHref,
  readPaymentsSearch,
  statusTabs,
  viewHref,
} from "./payments-search";

const BOOKING_ID = "3f1c2a4e-8b7d-4c6a-9e5f-1a2b3c4d5e6f";
const LISTING_ID = "8a9b0c1d-2e3f-4a5b-8c7d-9e0f1a2b3c4d";

describe("readPaymentsSearch", () => {
  it("opens on the set-aside events when the URL carries nothing", () => {
    const search = readPaymentsSearch({});

    expect(search.list).toBe("events");
    expect(search.view).toEqual({ list: "events", query: { limit: 20 } });
    expect(search.canonical).toBeNull();
    expect(search.errors).toEqual({});
  });

  it("asks for the open bounced refunds unless the resolved ones are named", () => {
    expect(readPaymentsSearch({ list: "bounced" }).view).toEqual({
      list: "bounced",
      query: { limit: 20, status: "OPEN" },
    });
    expect(
      readPaymentsSearch({ list: "bounced", status: "RESOLVED" }).view,
    ).toEqual({ list: "bounced", query: { limit: 20, status: "RESOLVED" } });
  });

  it("asks for the stuck stays of the kind its tab names, with the cursor", () => {
    expect(
      readPaymentsSearch({ list: "stuck-payouts", cursor: "abc" }).view,
    ).toEqual({
      list: "stuck-payouts",
      query: { limit: 20, kind: "payout", cursor: "abc" },
    });
    expect(readPaymentsSearch({ list: "stuck-refunds" }).view?.query).toEqual({
      limit: 20,
      kind: "refund",
    });
  });

  it("puts the filters of the tab into its query", () => {
    expect(
      readPaymentsSearch({
        eventId: "evt_1",
        type: "dispute",
        from: "2026-10-01",
      }).view,
    ).toEqual({
      list: "events",
      query: {
        limit: 20,
        eventId: "evt_1",
        type: "dispute",
        from: "2026-10-01",
      },
    });
    expect(
      readPaymentsSearch({
        list: "stuck-refunds",
        bookingId: BOOKING_ID,
        listingId: LISTING_ID,
      }).view?.query,
    ).toEqual({
      limit: 20,
      kind: "refund",
      bookingId: BOOKING_ID,
      listingId: LISTING_ID,
    });
  });

  it("refuses what the contract refuses, under the box it belongs to", () => {
    const search = readPaymentsSearch({
      list: "bounced",
      listingId: "not-a-uuid",
    });

    expect(search.view).toBeNull();
    expect(search.errors.listingId).toHaveLength(1);
    expect(search.values.listingId).toBe("not-a-uuid");
    // Shown whole on its chip: cut, it would hide what was typed.
    expect(activeFilters(search.list, search.values)).toEqual([
      {
        key: "listingId",
        label: "Listing not-a-uuid",
        href: "/admin/payments?list=bounced",
      },
    ]);

    const backwards = readPaymentsSearch({
      from: "2026-10-05",
      to: "2026-10-01",
    });

    expect(backwards.view).toBeNull();
    expect(backwards.errors.to).toEqual([
      "The last day must not be earlier than the first",
    ]);
  });

  it("lands an unknown list or status on the default, at its own address", () => {
    expect(readPaymentsSearch({ list: "nonsense" }).canonical).toBe(
      "/admin/payments",
    );
    expect(
      readPaymentsSearch({ list: "bounced", status: "LOST" }).canonical,
    ).toBe("/admin/payments?list=bounced");
  });

  it("drops what spells a default or belongs to another tab, and keeps the cursor", () => {
    expect(readPaymentsSearch({ list: "events" }).canonical).toBe(
      "/admin/payments",
    );
    expect(
      readPaymentsSearch({ list: "bounced", status: "OPEN" }).canonical,
    ).toBe("/admin/payments?list=bounced");
    expect(
      readPaymentsSearch({
        list: "stuck-refunds",
        status: "RESOLVED",
        refundId: "re_1",
        eventId: "evt_1",
        cursor: "abc",
      }).canonical,
    ).toBe("/admin/payments?list=stuck-refunds&cursor=abc");
    expect(readPaymentsSearch({ list: ["bounced", "events"] }).canonical).toBe(
      "/admin/payments",
    );
    // What a `GET` form submits: every box, the blanks included.
    expect(
      readPaymentsSearch({
        sort: "",
        list: "bounced",
        refundId: "re_1",
        paymentId: "",
        from: "",
      }).canonical,
    ).toBe("/admin/payments?list=bounced&refundId=re_1");
  });

  it("leaves alone every address the tabs, the pages and the notices write", () => {
    const hrefs = [
      setAsideHref("events"),
      setAsideHref("events", {}, "abc"),
      setAsideHref("events", { eventId: "evt_1" }),
      setAsideHref("bounced", { status: "RESOLVED" }, "abc"),
      setAsideHref("bounced", { refundId: "re_1" }),
      setAsideHref("stuck-payouts", { bookingId: BOOKING_ID }),
      setAsideHref("stuck-refunds", { from: "2026-10-01", to: "2026-10-02" }),
    ];

    for (const href of hrefs) {
      const params = Object.fromEntries(
        new URL(href, "http://localhost").searchParams,
      );

      expect(readPaymentsSearch(params).canonical).toBeNull();
    }
  });
});

describe("tabs, pages and chips", () => {
  it("opens every list at its first page, unfiltered, and marks the current one", () => {
    expect(
      listTabs("bounced").map(({ href, current }) => [href, current]),
    ).toEqual([
      ["/admin/payments", false],
      ["/admin/payments?list=bounced", true],
      ["/admin/payments?list=stuck-refunds", false],
      ["/admin/payments?list=stuck-payouts", false],
    ]);
  });

  it("carries the filters to the other half of the bounced refunds", () => {
    const { values } = readPaymentsSearch({
      list: "bounced",
      status: "RESOLVED",
      refundId: "re_1",
    });

    expect(
      statusTabs(values).map(({ href, current }) => [href, current]),
    ).toEqual([
      ["/admin/payments?list=bounced&refundId=re_1", false],
      ["/admin/payments?list=bounced&status=RESOLVED&refundId=re_1", true],
    ]);
  });

  it("pages within the list on the screen, its status and filters kept", () => {
    const search = readPaymentsSearch({
      list: "bounced",
      status: "RESOLVED",
      paymentId: "pi_1",
      cursor: "abc",
    });

    expect(nextPageHref(search, "def")).toBe(
      "/admin/payments?list=bounced&status=RESOLVED&paymentId=pi_1&cursor=def",
    );
    expect(firstPageHref(search)).toBe(
      "/admin/payments?list=bounced&status=RESOLVED&paymentId=pi_1",
    );
    expect(viewHref(search)).toBe(
      "/admin/payments?list=bounced&status=RESOLVED&paymentId=pi_1&cursor=abc",
    );
  });

  it("takes each filter off on its own, and clears them all but the half of the refunds", () => {
    const { list, values } = readPaymentsSearch({
      list: "bounced",
      status: "RESOLVED",
      listingId: LISTING_ID,
      from: "2026-10-01",
      cursor: "abc",
    });

    expect(
      activeFilters(list, values, { listing: "Cabin by the lake" }),
    ).toEqual([
      {
        key: "listingId",
        label: "Cabin by the lake",
        href: "/admin/payments?list=bounced&status=RESOLVED&from=2026-10-01",
      },
      {
        key: "from",
        label: "Set aside from 1 Oct 2026",
        href: `/admin/payments?list=bounced&status=RESOLVED&listingId=${LISTING_ID}`,
      },
    ]);
    expect(clearedFiltersHref(list, values)).toBe(
      "/admin/payments?list=bounced&status=RESOLVED",
    );
  });
});
