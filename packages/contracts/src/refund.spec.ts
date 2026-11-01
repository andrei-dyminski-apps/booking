import { describe, expect, it } from "vitest";
import {
  freeCancellationUntil,
  isCancellableOn,
  notRefunded,
  refundOnCancel,
  refundsInFull,
} from "./refund.js";
import { cents } from "./money.js";

const stay = { amountCents: cents(36_105), from: "2030-10-14" };

describe("freeCancellationUntil", () => {
  it("closes 48 hours before midnight UTC of the check-in day", () => {
    expect(freeCancellationUntil(stay.from).toISOString()).toBe(
      "2030-10-12T00:00:00.000Z",
    );
  });
});

describe("refundOnCancel", () => {
  it("gives a guest everything back inside the window", () => {
    expect(
      refundOnCancel(stay, new Date("2030-10-11T23:59:59.999Z"), "GUEST"),
    ).toBe(36_105);
  });

  it("gives a guest nothing from the moment the window closes", () => {
    // The boundary itself is outside: the window is "before", not "at or before".
    expect(
      refundOnCancel(stay, new Date("2030-10-12T00:00:00.000Z"), "GUEST"),
    ).toBe(0);
    expect(
      refundOnCancel(stay, new Date("2030-10-13T12:00:00.000Z"), "GUEST"),
    ).toBe(0);
  });

  it("refunds an admin's cancellation in full after the window closed", () => {
    expect(
      refundOnCancel(stay, new Date("2030-10-13T12:00:00.000Z"), "ADMIN"),
    ).toBe(36_105);
  });
});

describe("refundsInFull", () => {
  it("answers the window as refundOnCancel applies it", () => {
    expect(
      refundsInFull(stay.from, new Date("2030-10-11T23:59:59.999Z"), "GUEST"),
    ).toBe(true);
    expect(
      refundsInFull(stay.from, new Date("2030-10-12T00:00:00.000Z"), "GUEST"),
    ).toBe(false);
    expect(
      refundsInFull(stay.from, new Date("2030-10-13T12:00:00.000Z"), "ADMIN"),
    ).toBe(true);
  });
});

describe("isCancellableOn", () => {
  it("lets a hold go at any time", () => {
    expect(
      isCancellableOn(
        { status: "PENDING_PAYMENT", from: stay.from },
        "2030-10-20",
      ),
    ).toBe(true);
  });

  it("lets a confirmed stay go only before its check-in day", () => {
    const confirmed = { status: "CONFIRMED" as const, from: stay.from };

    expect(isCancellableOn(confirmed, "2030-10-13")).toBe(true);
    expect(isCancellableOn(confirmed, "2030-10-14")).toBe(false);
    expect(isCancellableOn(confirmed, "2030-10-20")).toBe(false);
  });

  it("never lets a stay that already let go of its nights go again", () => {
    expect(
      isCancellableOn({ status: "CANCELLED", from: stay.from }, "2030-10-01"),
    ).toBe(false);
    expect(
      isCancellableOn({ status: "EXPIRED", from: stay.from }, "2030-10-01"),
    ).toBe(false);
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
