import { describe, expect, it } from "vitest";
import { CURRENCY, cents, DisputeStatus } from "@repo/contracts";
import { earlyEndNote, earlyEndTerms, endedEarlyNote } from "./early-end-note";

const stay = {
  nights: [
    { date: "2026-11-10", priceCents: cents(12_000) },
    { date: "2026-11-11", priceCents: cents(12_000) },
    { date: "2026-11-12", priceCents: cents(15_035) },
  ],
  cancellationPolicy: "FLEXIBLE" as const,
  amountCents: cents(39_035),
  refundedAmountCents: null,
  currency: CURRENCY,
  paid: true,
  dispute: null,
  timeZone: "UTC",
};

/** Noon UTC of a day. */
const at = (day: string): Date => new Date(`${day}T12:00:00.000Z`);

const LEAVING =
  "The stay checks out tomorrow, 11 Nov 2026, and the 2 nights after tonight go back on offer.";

describe("earlyEndTerms", () => {
  it("sends the check-out and the refund the note states", () => {
    expect(earlyEndTerms(stay, at("2026-11-10"))).toEqual({
      checkOut: "2026-11-11",
      refundCents: cents(27_035),
      note: earlyEndNote(stay, at("2026-11-10")),
    });
    expect(
      earlyEndTerms(
        { ...stay, refundedAmountCents: cents(30_000) },
        at("2026-11-10"),
      ).refundCents,
    ).toBe(6257);
  });

  it("states no refund wherever the note promises none", () => {
    for (const nothing of [
      { ...stay, paid: false },
      { ...stay, dispute: DisputeStatus.LOST },
      { ...stay, refundedAmountCents: stay.amountCents },
      { ...stay, cancellationPolicy: "FIRM" as const },
    ]) {
      expect(earlyEndTerms(nothing, at("2026-11-10")).refundCents).toBe(0);
    }
  });
});

describe("earlyEndNote", () => {
  it("uses tonight and states the share of the nights after it", () => {
    expect(earlyEndNote(stay, at("2026-11-10"))).toBe(
      `${LEAVING} The stay's cancellation policy refunds 100% of them: $270.35 back to the card it was paid with.`,
    );
  });

  it("names a single night on the night before the last", () => {
    expect(earlyEndNote(stay, at("2026-11-11"))).toMatch(
      /tomorrow, 12 Nov 2026, and the 1 night after tonight goes back on offer\./,
    );
  });

  it("says so when the policy keeps the unused nights", () => {
    expect(
      earlyEndNote({ ...stay, cancellationPolicy: "FIRM" }, at("2026-11-10")),
    ).toBe(
      `${LEAVING} The stay's cancellation policy refunds nothing for unused nights.`,
    );
  });

  it("says so when earlier refunds already gave back part of the nights", () => {
    expect(
      earlyEndNote(
        { ...stay, refundedAmountCents: cents(30_000) },
        at("2026-11-10"),
      ),
    ).toBe(
      `${LEAVING} The stay's cancellation policy refunds 100% of what is left of them after the earlier refunds, which gave back part of every night: $62.57 back to the card it was paid with.`,
    );
  });

  it("promises no refund of a stay nobody paid, a lost dispute or one refunded in full", () => {
    expect(earlyEndNote({ ...stay, paid: false }, at("2026-11-10"))).toBe(
      `${LEAVING} Nothing was paid for the stay.`,
    );
    expect(
      earlyEndNote({ ...stay, dispute: DisputeStatus.LOST }, at("2026-11-10")),
    ).toMatch(/returned the payment after a dispute/);
    expect(
      earlyEndNote(
        { ...stay, refundedAmountCents: stay.amountCents },
        at("2026-11-10"),
      ),
    ).toMatch(/refunded in full already/);
  });
});

describe("endedEarlyNote", () => {
  it("states the new check-out against the booked one and the nights given up", () => {
    expect(
      endedEarlyNote({
        ...stay,
        to: "2026-11-11",
        endedEarlyAt: "2026-11-10T09:30:00.000Z",
      }),
    ).toMatch(
      /^Ended early on .+ UTC: it checks out on 11 Nov 2026 instead of 13 Nov 2026, and the 2 nights after that went back on offer\.$/,
    );
  });

  it("is nothing for a stay that was not ended early", () => {
    expect(
      endedEarlyNote({ ...stay, to: "2026-11-13", endedEarlyAt: null }),
    ).toBeNull();
  });
});
