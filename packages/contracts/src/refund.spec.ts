import { describe, expect, it } from "vitest";
import {
  cancellerOf,
  checkInInstant,
  isCancellableOn,
  notRefunded,
  refundQuote,
  refundSchedule,
} from "./refund.js";
import type { CancellationPolicy } from "./cancellation-policy.js";
import { cents } from "./money.js";

const from = "2030-10-14";

/** Booked long ago, so the grace period is over unless a test says otherwise. */
const stayUnder = (
  cancellationPolicy: CancellationPolicy,
  overrides: Partial<{ createdAt: string; amountCents: number }> = {},
) => ({
  from,
  createdAt: overrides.createdAt ?? "2030-01-01T00:00:00.000Z",
  cancellationPolicy,
  amountCents: cents(overrides.amountCents ?? 36_105),
  refundedAmountCents: null,
});

const at = (iso: string): Date => new Date(iso);

/** The share a guest is quoted at `iso`. */
const shareAt = (stay: ReturnType<typeof stayUnder>, iso: string): number =>
  refundQuote(stay, at(iso), "GUEST").shareBps;

describe("checkInInstant", () => {
  it("is midnight UTC of the check-in day", () => {
    expect(checkInInstant({ from }).toISOString()).toBe(
      "2030-10-14T00:00:00.000Z",
    );
  });
});

describe("refundQuote under each policy", () => {
  it("FLEXIBLE: everything back until 48 hours before check-in, nothing from then on", () => {
    const stay = stayUnder("FLEXIBLE");

    expect(shareAt(stay, "2030-10-11T23:59:59.999Z")).toBe(10_000);
    // The boundary itself is outside: the window is "before", not "at or before".
    expect(shareAt(stay, "2030-10-12T00:00:00.000Z")).toBe(0);
    expect(shareAt(stay, "2030-10-13T12:00:00.000Z")).toBe(0);
  });

  it("MODERATE: everything back until 5 days before", () => {
    const stay = stayUnder("MODERATE");

    expect(shareAt(stay, "2030-10-08T23:59:59.999Z")).toBe(10_000);
    expect(shareAt(stay, "2030-10-09T00:00:00.000Z")).toBe(0);
  });

  it("LIMITED: everything until 14 days before, half until 7, nothing after", () => {
    const stay = stayUnder("LIMITED");

    expect(shareAt(stay, "2030-09-29T23:59:59.999Z")).toBe(10_000);
    expect(shareAt(stay, "2030-09-30T00:00:00.000Z")).toBe(5_000);
    expect(shareAt(stay, "2030-10-06T23:59:59.999Z")).toBe(5_000);
    expect(shareAt(stay, "2030-10-07T00:00:00.000Z")).toBe(0);
  });

  it("FIRM: everything until 30 days before, half until 7, nothing after", () => {
    const stay = stayUnder("FIRM");

    expect(shareAt(stay, "2030-09-13T23:59:59.999Z")).toBe(10_000);
    expect(shareAt(stay, "2030-09-14T00:00:00.000Z")).toBe(5_000);
    expect(shareAt(stay, "2030-10-06T23:59:59.999Z")).toBe(5_000);
    expect(shareAt(stay, "2030-10-07T00:00:00.000Z")).toBe(0);
  });

  it("NON_REFUNDABLE: nothing, however early", () => {
    expect(
      refundQuote(
        stayUnder("NON_REFUNDABLE"),
        at("2030-01-01T00:00:00.000Z"),
        "GUEST",
      ),
    ).toEqual({ shareBps: 0, cents: 0, next: null, closed: null });
  });

  it("says when the share falls and to what", () => {
    expect(
      refundQuote(stayUnder("LIMITED"), at("2030-09-01T00:00:00.000Z"), "GUEST")
        .next,
    ).toEqual({ until: at("2030-09-30T00:00:00.000Z"), shareBps: 5_000 });
    expect(
      refundQuote(stayUnder("LIMITED"), at("2030-10-01T00:00:00.000Z"), "GUEST")
        .next,
    ).toEqual({ until: at("2030-10-07T00:00:00.000Z"), shareBps: 0 });
    expect(
      refundQuote(stayUnder("LIMITED"), at("2030-10-08T00:00:00.000Z"), "GUEST")
        .next,
    ).toBeNull();
  });

  it("names the window that closed last, and none before the first closes", () => {
    const limited = stayUnder("LIMITED");

    expect(
      refundQuote(limited, at("2030-09-01T00:00:00.000Z"), "GUEST").closed,
    ).toBeNull();
    expect(
      refundQuote(limited, at("2030-10-01T00:00:00.000Z"), "GUEST").closed,
    ).toEqual({ until: at("2030-09-30T00:00:00.000Z"), shareBps: 10_000 });
    expect(
      refundQuote(limited, at("2030-10-08T00:00:00.000Z"), "GUEST").closed,
    ).toEqual({ until: at("2030-10-07T00:00:00.000Z"), shareBps: 5_000 });
  });
});

describe("the grace period", () => {
  // Booked 10 days before check-in, at noon: the grace period runs until noon the next day.
  const booked = "2030-10-04T12:00:00.000Z";

  it("refunds in full for 24 hours after booking, then the policy applies", () => {
    const stay = stayUnder("FIRM", { createdAt: booked });

    expect(shareAt(stay, "2030-10-05T11:59:00.000Z")).toBe(10_000);
    expect(shareAt(stay, "2030-10-05T12:01:00.000Z")).toBe(5_000);
  });

  it("needs check-in still more than 7 days away", () => {
    // Booked 7 days and 1 hour before: the grace period ends when check-in is 7 days away.
    const stay = stayUnder("FIRM", { createdAt: "2030-10-06T23:00:00.000Z" });

    expect(shareAt(stay, "2030-10-06T23:59:59.999Z")).toBe(10_000);
    expect(shareAt(stay, "2030-10-07T00:00:00.000Z")).toBe(0);

    // Booked 6 days before: no grace at all.
    expect(
      shareAt(
        stayUnder("FIRM", { createdAt: "2030-10-08T00:00:00.000Z" }),
        "2030-10-08T00:01:00.000Z",
      ),
    ).toBe(0);
  });

  it("does not apply to a non-refundable stay", () => {
    expect(
      shareAt(
        stayUnder("NON_REFUNDABLE", { createdAt: booked }),
        "2030-10-04T12:01:00.000Z",
      ),
    ).toBe(0);
  });

  it("says the grace period's end as the next change", () => {
    expect(
      refundQuote(
        stayUnder("FIRM", { createdAt: booked }),
        at("2030-10-04T13:00:00.000Z"),
        "GUEST",
      ).next,
    ).toEqual({ until: at("2030-10-05T12:00:00.000Z"), shareBps: 5_000 });
  });
});

describe("refundSchedule", () => {
  it("folds overlapping full windows into one", () => {
    // The grace period ends before the 30-day window does, so it adds nothing.
    expect(
      refundSchedule({
        from,
        createdAt: "2030-09-01T00:00:00.000Z",
        cancellationPolicy: "FIRM",
      }),
    ).toEqual([
      { until: at("2030-09-14T00:00:00.000Z"), shareBps: 10_000 },
      { until: at("2030-10-07T00:00:00.000Z"), shareBps: 5_000 },
    ]);
  });

  it("leaves out the windows that closed before the stay was booked", () => {
    // MODERATE, booked 3 days before check-in: the 5-day window and the clipped grace
    // period both closed before the booking existed.
    expect(
      refundSchedule({
        from,
        createdAt: "2030-10-11T00:00:00.000Z",
        cancellationPolicy: "MODERATE",
      }),
    ).toEqual([]);

    // LIMITED, booked 5 days before: the half window closed too, and the grace period
    // folded over it must not turn it into a full one.
    expect(
      refundSchedule({
        from,
        createdAt: "2030-10-09T00:00:00.000Z",
        cancellationPolicy: "LIMITED",
      }),
    ).toEqual([]);
  });

  it("keeps a window the booking fell inside", () => {
    // LIMITED, booked 10 days before: a day of grace, then half until 7 days before.
    expect(
      refundSchedule({
        from,
        createdAt: "2030-10-04T12:00:00.000Z",
        cancellationPolicy: "LIMITED",
      }),
    ).toEqual([
      { until: at("2030-10-05T12:00:00.000Z"), shareBps: 10_000 },
      { until: at("2030-10-07T00:00:00.000Z"), shareBps: 5_000 },
    ]);
  });

  it("is empty for a stay that never refunds a guest", () => {
    expect(
      refundSchedule({
        from,
        createdAt: "2030-09-01T00:00:00.000Z",
        cancellationPolicy: "NON_REFUNDABLE",
      }),
    ).toEqual([]);
  });
});

describe("refundQuote amounts", () => {
  it("rounds a half share up, in the guest's favour", () => {
    const stay = stayUnder("LIMITED", { amountCents: 36_105 });

    expect(
      refundQuote(stay, at("2030-10-01T00:00:00.000Z"), "GUEST").cents,
    ).toBe(18_053);
  });

  it("takes what was refunded already off the share, never below nothing", () => {
    const now = at("2030-10-01T00:00:00.000Z");
    const stay = stayUnder("LIMITED", { amountCents: 36_105 });

    expect(
      refundQuote({ ...stay, refundedAmountCents: cents(10_000) }, now, "GUEST")
        .cents,
    ).toBe(8_053);
    expect(
      refundQuote({ ...stay, refundedAmountCents: cents(20_000) }, now, "GUEST")
        .cents,
    ).toBe(0);
  });

  it.each(["ADMIN", "HOST"] as const)(
    "refunds a cancellation by %s of whatever is left in full, whatever the policy",
    (canceller) => {
      const stay = {
        ...stayUnder("NON_REFUNDABLE"),
        refundedAmountCents: cents(10_000),
      };

      expect(
        refundQuote(stay, at("2030-10-13T12:00:00.000Z"), canceller),
      ).toEqual({
        shareBps: 10_000,
        cents: 26_105,
        next: null,
        closed: null,
      });
    },
  );
});

describe("isCancellableOn", () => {
  it("lets a hold go at any time", () => {
    expect(
      isCancellableOn({ status: "PENDING_PAYMENT", from }, "2030-10-20"),
    ).toBe(true);
  });

  it("lets a confirmed stay go only before its check-in day", () => {
    const confirmed = { status: "CONFIRMED" as const, from };

    expect(isCancellableOn(confirmed, "2030-10-13")).toBe(true);
    expect(isCancellableOn(confirmed, "2030-10-14")).toBe(false);
    expect(isCancellableOn(confirmed, "2030-10-20")).toBe(false);
  });

  it("never lets a stay that already let go of its nights go again", () => {
    expect(isCancellableOn({ status: "CANCELLED", from }, "2030-10-01")).toBe(
      false,
    );
    expect(isCancellableOn({ status: "EXPIRED", from }, "2030-10-01")).toBe(
      false,
    );
  });
});

describe("notRefunded", () => {
  it("leaves what the refunds recorded so far have not given back", () => {
    expect(notRefunded(cents(36_105), null)).toBe(36_105);
    expect(notRefunded(cents(36_105), cents(10_000))).toBe(26_105);
  });

  it("is nothing for a stay refunded in full or past it, never a negative amount", () => {
    expect(notRefunded(cents(36_105), cents(36_105))).toBe(0);
    expect(notRefunded(cents(36_105), cents(40_000))).toBe(0);
  });
});

describe("cancellerOf", () => {
  const stay = { guestId: "guest", hostId: "host" };

  it("names the guest, the host and an admin on somebody else's stay", () => {
    expect(cancellerOf(stay, { id: "guest", role: "USER" })).toBe("GUEST");
    expect(cancellerOf(stay, { id: "host", role: "USER" })).toBe("HOST");
    expect(cancellerOf(stay, { id: "admin", role: "ADMIN" })).toBe("ADMIN");
    expect(cancellerOf(stay, { id: "stranger", role: "USER" })).toBeNull();
  });

  it("keeps an account promoted to admin to its side of its own stay", () => {
    expect(cancellerOf(stay, { id: "guest", role: "ADMIN" })).toBe("GUEST");
    expect(cancellerOf(stay, { id: "host", role: "ADMIN" })).toBe("HOST");
  });
});
