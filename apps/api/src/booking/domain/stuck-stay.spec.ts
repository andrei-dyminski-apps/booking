import {
  BookingStatus,
  DisputeStatus,
  owedToHost,
  StuckKind,
  type Booking,
} from "@repo/contracts";
import { CURRENCY, cents, NO_CENTS } from "../../payment/domain/money";
import { owedOnStuck } from "./stuck-stay";

const stay: Booking = {
  id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  listingId: "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f",
  listing: {
    title: "Loft above the harbour",
    pricePerNightCents: cents(12_000),
  },
  guestId: "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50",
  from: "2026-09-01",
  to: "2026-09-05",
  status: BookingStatus.CONFIRMED,
  amountCents: cents(48_000),
  currency: CURRENCY,
  cancellationPolicy: "FLEXIBLE",
  refundedAmountCents: cents(12_000),
  refundOwedCents: null,
  paid: true,
  dispute: null,
  expiresAt: "2026-08-20T12:15:00.000Z",
  createdAt: "2026-08-20T12:00:00.000Z",
  reviewed: { byGuest: false, byOwner: false },
};

describe("owedOnStuck", () => {
  it("states the refund a cancellation still owes the guest", () => {
    const cancelled: Booking = {
      ...stay,
      status: BookingStatus.CANCELLED,
      refundOwedCents: cents(36_000),
    };

    expect(owedOnStuck(StuckKind.refund, cancelled)).toBe(36_000);
  });

  it("states nothing for a refund no longer owed", () => {
    expect(owedOnStuck(StuckKind.refund, stay)).toBe(NO_CENTS);
  });

  it("states the host's share by the rule the payout is computed by", () => {
    expect(owedOnStuck(StuckKind.payout, stay)).toBe(owedToHost(stay));
    expect(owedOnStuck(StuckKind.payout, stay)).toBeGreaterThan(0);
  });

  it("states nothing for the host once a dispute is lost", () => {
    expect(
      owedOnStuck(StuckKind.payout, { ...stay, dispute: DisputeStatus.LOST }),
    ).toBe(NO_CENTS);
  });
});
