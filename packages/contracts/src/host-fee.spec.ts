import { describe, expect, it } from "vitest";
import { hostCancellationFee, stillOwed } from "./host-fee.js";
import { cents } from "./money.js";

const from = "2030-10-14";
const confirmed = {
  status: "CONFIRMED" as const,
  paid: true,
  dispute: null,
  from,
  amountCents: cents(36_105),
  refundedAmountCents: null,
};

const feeAt = (iso: string) => hostCancellationFee(confirmed, new Date(iso));

describe("hostCancellationFee", () => {
  it("costs a tenth more than 30 days before check-in", () => {
    expect(feeAt("2030-09-13T23:59:59.999Z")).toEqual({
      feeBps: 1_000,
      cents: 3_611,
    });
  });

  it("costs a quarter from 30 days before to 48 hours before", () => {
    // At the very moment a window closes, the next one applies.
    expect(feeAt("2030-09-14T00:00:00.000Z").feeBps).toBe(2_500);
    expect(feeAt("2030-10-11T23:59:59.999Z")).toEqual({
      feeBps: 2_500,
      cents: 9_026,
    });
  });

  it("costs half inside the last 48 hours", () => {
    expect(feeAt("2030-10-12T00:00:00.000Z")).toEqual({
      feeBps: 5_000,
      cents: 18_053,
    });
  });

  it("costs nothing to decline a hold nobody has paid for", () => {
    expect(
      hostCancellationFee(
        { ...confirmed, status: "PENDING_PAYMENT" },
        new Date("2030-10-13T00:00:00.000Z"),
      ),
    ).toEqual({ feeBps: 0, cents: 0 });
  });

  it("costs nothing for a stay nobody paid for, nor for one refunded in full already", () => {
    const at = new Date("2030-10-13T00:00:00.000Z");

    expect(hostCancellationFee({ ...confirmed, paid: false }, at)).toEqual({
      feeBps: 0,
      cents: 0,
    });
    expect(
      hostCancellationFee(
        { ...confirmed, refundedAmountCents: cents(36_105) },
        at,
      ),
    ).toEqual({ feeBps: 0, cents: 0 });
  });

  it("costs nothing for a stay whose dispute was lost, as the cancellation refunds nothing", () => {
    expect(
      hostCancellationFee(
        { ...confirmed, dispute: "LOST" },
        new Date("2030-10-13T00:00:00.000Z"),
      ),
    ).toEqual({ feeBps: 0, cents: 0 });
  });

  it("is a share of what the cancellation refunds, not of a payment refunded in part already", () => {
    expect(
      hostCancellationFee(
        { ...confirmed, refundedAmountCents: cents(16_105) },
        new Date("2030-10-12T00:00:00.000Z"),
      ),
    ).toEqual({ feeBps: 5_000, cents: 10_000 });
  });
});

describe("stillOwed", () => {
  it("is what was not withheld, and nothing once waived or withheld in full", () => {
    const fee = {
      amountCents: cents(10_000),
      withheldCents: cents(4_000),
      waivedAt: null,
    };

    expect(stillOwed(fee)).toBe(6_000);
    expect(stillOwed({ ...fee, waivedAt: "2030-01-01T00:00:00.000Z" })).toBe(0);
    expect(stillOwed({ ...fee, withheldCents: cents(10_000) })).toBe(0);
  });
});
