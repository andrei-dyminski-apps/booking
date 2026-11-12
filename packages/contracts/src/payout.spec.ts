import { describe, expect, it } from "vitest";
import { DisputeStatus } from "./booking.js";
import { cents } from "./money.js";
import { hostShare, owedToHost, payoutDueAt } from "./payout.js";

describe("hostShare", () => {
  it("pays the host the stay less the platform's 15%, to the cent", () => {
    expect(hostShare(cents(36_105), cents(0))).toBe(30_689);
    expect(hostShare(cents(48_000), cents(0))).toBe(40_800);
  });

  it("rounds an exact half of a cent up, in the host's favour", () => {
    // 85% of 36110 cents is 30693.5.
    expect(hostShare(cents(36_110), cents(0))).toBe(30_694);
  });

  it("pays on what is left after a partial refund", () => {
    expect(hostShare(cents(48_000), cents(8_000))).toBe(34_000);
  });

  it("pays nothing for a stay refunded in full, or past it", () => {
    expect(hostShare(cents(36_105), cents(36_105))).toBe(0);
    expect(hostShare(cents(10_000), cents(12_000))).toBe(0);
  });
});

describe("owedToHost", () => {
  const stay = {
    amountCents: cents(48_000),
    refundedAmountCents: null,
    refundOwedCents: null,
    paid: true,
    dispute: null,
  };

  it("owes the host's share of a paid stay", () => {
    expect(owedToHost(stay)).toBe(40_800);
  });

  it("counts a refund still owed as gone already, beside what was refunded", () => {
    expect(
      owedToHost({
        ...stay,
        refundedAmountCents: cents(3_000),
        refundOwedCents: cents(5_000),
      }),
    ).toBe(34_000);
  });

  it("owes nothing for a stay never paid or a dispute lost", () => {
    expect(owedToHost({ ...stay, paid: false })).toBe(0);
    expect(owedToHost({ ...stay, dispute: DisputeStatus.LOST })).toBe(0);
    expect(owedToHost({ ...stay, dispute: DisputeStatus.OPEN })).toBe(40_800);
  });
});

describe("payoutDueAt", () => {
  it("falls due a day after midnight UTC of the check-in day for a stay from before the time zones", () => {
    expect(
      payoutDueAt({
        from: "2030-10-14",
        timeZone: "UTC",
        checkInTime: "00:00",
      }).toISOString(),
    ).toBe("2030-10-15T00:00:00.000Z");
  });

  it("falls due a day after the moment of check-in on the listing's clock", () => {
    expect(
      payoutDueAt({
        from: "2030-10-14",
        timeZone: "Pacific/Kiritimati",
        checkInTime: "15:00",
      }).toISOString(),
    ).toBe("2030-10-15T01:00:00.000Z");
    expect(
      payoutDueAt({
        from: "2030-10-14",
        timeZone: "Pacific/Honolulu",
        checkInTime: "15:00",
      }).toISOString(),
    ).toBe("2030-10-16T01:00:00.000Z");
  });
});
