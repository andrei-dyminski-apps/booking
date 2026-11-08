import { describe, expect, it } from "vitest";
import { adminRefundSchema, refundableCents } from "./adjustment.js";
import { cents } from "./money.js";

const TODAY = "2026-11-08";

/** A stay under way since yesterday: nothing about the day caps what may go back. */
const stay = {
  status: "CONFIRMED" as const,
  from: "2026-11-07",
  paid: true,
  dispute: null,
  amountCents: cents(36_105),
  refundedAmountCents: null,
  refundOwedCents: null,
};

describe("refundableCents", () => {
  it("is the whole payment of a stay nothing went back from", () => {
    expect(refundableCents(stay, TODAY)).toBe(36_105);
  });

  it("leaves out what was refunded and what a cancellation still owes", () => {
    expect(
      refundableCents(
        {
          ...stay,
          refundedAmountCents: cents(10_000),
          refundOwedCents: cents(6_105),
        },
        TODAY,
      ),
    ).toBe(20_000);
  });

  it("is nothing once the refunds and the debt cover the payment, never negative", () => {
    expect(
      refundableCents({ ...stay, refundedAmountCents: cents(36_105) }, TODAY),
    ).toBe(0);
    expect(
      refundableCents(
        {
          ...stay,
          refundedAmountCents: cents(30_000),
          refundOwedCents: cents(10_000),
        },
        TODAY,
      ),
    ).toBe(0);
  });

  it("is nothing for a stay nobody paid for, or whose dispute was lost", () => {
    expect(refundableCents({ ...stay, paid: false }, TODAY)).toBe(0);
    expect(refundableCents({ ...stay, dispute: "LOST" }, TODAY)).toBe(0);
  });

  it("counts an open or won dispute like none", () => {
    expect(refundableCents({ ...stay, dispute: "WON" }, TODAY)).toBe(36_105);
    expect(refundableCents({ ...stay, dispute: "OPEN" }, TODAY)).toBe(36_105);
  });

  it("keeps the last cent of a stay that has not begun, which a full refund would cancel", () => {
    const ahead = { ...stay, from: "2026-11-09" };

    expect(refundableCents(ahead, TODAY)).toBe(36_104);
    expect(
      refundableCents({ ...ahead, refundedAmountCents: cents(36_104) }, TODAY),
    ).toBe(0);
  });

  it("gives back all that is left from the check-in day on, and of a cancelled stay", () => {
    expect(refundableCents({ ...stay, from: TODAY }, TODAY)).toBe(36_105);
    expect(
      refundableCents(
        {
          ...stay,
          status: "CANCELLED",
          from: "2026-11-20",
          refundedAmountCents: cents(18_000),
        },
        TODAY,
      ),
    ).toBe(18_105);
  });
});

describe("adminRefundSchema", () => {
  const body = {
    amountCents: 5_000,
    reason: "The hot water was off for two nights",
    requestId: "5b0cbbd4-4f43-4a4e-9a8f-1f1a0f7b3c11",
  };

  it("takes an amount, a reason and the request's id", () => {
    expect(adminRefundSchema.parse(body)).toEqual(body);
  });

  it("refuses nothing to refund, a fraction of a cent and a blank reason", () => {
    expect(
      adminRefundSchema.safeParse({ ...body, amountCents: 0 }).success,
    ).toBe(false);
    expect(
      adminRefundSchema.safeParse({ ...body, amountCents: 10.5 }).success,
    ).toBe(false);
    expect(
      adminRefundSchema.safeParse({ ...body, reason: "   " }).success,
    ).toBe(false);
  });
});
