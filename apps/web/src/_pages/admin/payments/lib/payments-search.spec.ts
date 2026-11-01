import { describe, expect, it } from "vitest";
import { setAsideHref } from "#shared/config";
import {
  firstPageHref,
  listTabs,
  nextPageHref,
  readPaymentsSearch,
  statusTabs,
  viewHref,
} from "./payments-search";

describe("readPaymentsSearch", () => {
  it("opens on the set-aside events when the URL carries nothing", () => {
    expect(readPaymentsSearch({})).toEqual({
      view: { list: "events", query: { limit: 20 } },
      canonical: null,
    });
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
    expect(readPaymentsSearch({ list: "stuck-refunds" }).view.query).toEqual({
      limit: 20,
      kind: "refund",
    });
  });

  it("lands an unknown list or status on the default, at its own address", () => {
    expect(readPaymentsSearch({ list: "nonsense" })).toEqual({
      view: { list: "events", query: { limit: 20 } },
      canonical: "/admin/payments",
    });
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
        cursor: "abc",
      }).canonical,
    ).toBe("/admin/payments?list=stuck-refunds&cursor=abc");
    expect(readPaymentsSearch({ list: ["bounced", "events"] }).canonical).toBe(
      "/admin/payments",
    );
  });

  it("leaves alone every address the tabs and the notices write", () => {
    const hrefs = [
      setAsideHref("events"),
      setAsideHref("events", undefined, "abc"),
      setAsideHref("bounced", "RESOLVED", "abc"),
      setAsideHref("stuck-payouts"),
    ];

    for (const href of hrefs) {
      const params = Object.fromEntries(
        new URL(href, "http://localhost").searchParams,
      );

      expect(readPaymentsSearch(params).canonical).toBeNull();
    }
  });
});

describe("tabs and pages", () => {
  it("opens every list at its first page and marks the current one", () => {
    expect(
      listTabs("bounced").map(({ href, current }) => [href, current]),
    ).toEqual([
      ["/admin/payments", false],
      ["/admin/payments?list=bounced", true],
      ["/admin/payments?list=stuck-refunds", false],
      ["/admin/payments?list=stuck-payouts", false],
    ]);
    expect(
      statusTabs("RESOLVED").map(({ href, current }) => [href, current]),
    ).toEqual([
      ["/admin/payments?list=bounced", false],
      ["/admin/payments?list=bounced&status=RESOLVED", true],
    ]);
  });

  it("pages within the list on the screen, the status of the refunds kept", () => {
    const { view } = readPaymentsSearch({
      list: "bounced",
      status: "RESOLVED",
      cursor: "abc",
    });

    expect(nextPageHref(view, "def")).toBe(
      "/admin/payments?list=bounced&status=RESOLVED&cursor=def",
    );
    expect(firstPageHref(view)).toBe(
      "/admin/payments?list=bounced&status=RESOLVED",
    );
    expect(viewHref(view)).toBe(
      "/admin/payments?list=bounced&status=RESOLVED&cursor=abc",
    );
  });
});
