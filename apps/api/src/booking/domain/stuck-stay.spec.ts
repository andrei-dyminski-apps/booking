import {
  BookingStatus,
  DisputeStatus,
  owedToHost,
  StuckKind,
  type Booking,
} from "@repo/contracts";
import {
  CURRENCY,
  cents,
  NO_CENTS,
  subtractCents,
} from "../../payment/domain/money";
import type { StuckPayout } from "./booking.types";
import { hostFeesKey, owedOnStuck, shareOutHostFees } from "./stuck-stay";

const stay: Booking = {
  id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  listingId: "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f",
  listing: {
    title: "Loft above the harbour",
    pricePerNightCents: cents(12_000),
  },
  guestId: "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50",
  hostId: "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f51",
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
  cancelledBy: null,
  cancelledAt: null,
  cancellationReason: null,
  endedEarlyAt: null,
  reviewed: { byGuest: false, byOwner: false },
};

const noFees: StuckPayout = {
  reservedCents: null,
  feeWithheldCents: NO_CENTS,
  hostFeesOwedCents: NO_CENTS,
};

describe("owedOnStuck", () => {
  it("states the refund a cancellation still owes the guest", () => {
    const cancelled: Booking = {
      ...stay,
      status: BookingStatus.CANCELLED,
      refundOwedCents: cents(36_000),
    };

    expect(owedOnStuck(StuckKind.refund, cancelled, null)).toBe(36_000);
  });

  it("states nothing for a refund no longer owed", () => {
    expect(owedOnStuck(StuckKind.refund, stay, null)).toBe(NO_CENTS);
  });

  it("states the host's share by the rule the payout is computed by", () => {
    expect(owedOnStuck(StuckKind.payout, stay, noFees)).toBe(owedToHost(stay));
    expect(owedOnStuck(StuckKind.payout, stay, noFees)).toBeGreaterThan(0);
  });

  it("states nothing for the host once a dispute is lost", () => {
    expect(
      owedOnStuck(
        StuckKind.payout,
        { ...stay, dispute: DisputeStatus.LOST },
        noFees,
      ),
    ).toBe(NO_CENTS);
  });

  it("takes the fees the host owes off the share, as the payout keeps them back", () => {
    const fees = cents(5_000);

    expect(
      owedOnStuck(StuckKind.payout, stay, {
        ...noFees,
        hostFeesOwedCents: fees,
      }),
    ).toBe(subtractCents(owedToHost(stay), fees));
    expect(
      owedOnStuck(StuckKind.payout, stay, {
        ...noFees,
        hostFeesOwedCents: cents(owedToHost(stay) + 1),
      }),
    ).toBe(NO_CENTS);
  });

  it("states a reservation still standing as it is while the stay covers it", () => {
    const reserved = cents(10_000);

    expect(
      owedOnStuck(StuckKind.payout, stay, {
        reservedCents: reserved,
        feeWithheldCents: cents(2_000),
        hostFeesOwedCents: cents(50_000),
      }),
    ).toBe(reserved);
    // Outgrown by a refund: the job hands it back, its 2 000 owed again, and reserves afresh.
    expect(
      owedOnStuck(StuckKind.payout, stay, {
        reservedCents: owedToHost(stay),
        feeWithheldCents: cents(2_000),
        hostFeesOwedCents: cents(1_000),
      }),
    ).toBe(subtractCents(owedToHost(stay), cents(3_000)));
  });
});

describe("shareOutHostFees", () => {
  const OTHER_HOST = "8f2b4e3a-3c4d-4e5f-8a7b-1c2d3e4f5a62";
  const nothingReserved = { reservedCents: null, feeWithheldCents: NO_CENTS };
  const stayOf = (id: string, hostId = stay.hostId) => ({
    booking: { ...stay, id, hostId },
    payout: nothingReserved,
  });

  it("takes one debt off once across a host's stuck payouts, the first set aside first", () => {
    const share = owedToHost(stay);
    const fees = cents(share + 5_000);
    const left = shareOutHostFees(
      [stayOf("first"), stayOf("second"), stayOf("third")],
      new Map([[hostFeesKey(stay.hostId, stay.currency), fees]]),
    );

    expect([...left.entries()]).toEqual([
      ["first", fees],
      ["second", cents(5_000)],
      ["third", NO_CENTS],
    ]);

    const sent = ["first", "second", "third"].map((id) =>
      owedOnStuck(StuckKind.payout, stay, {
        ...nothingReserved,
        hostFeesOwedCents: left.get(id) ?? NO_CENTS,
      }),
    );

    // Retrying all three sends the three shares less the debt, once.
    expect(sent).toEqual([NO_CENTS, subtractCents(share, cents(5_000)), share]);
  });

  it("keeps each host's debt to their own stays", () => {
    const left = shareOutHostFees(
      [stayOf("mine"), stayOf("theirs", OTHER_HOST)],
      new Map([[hostFeesKey(stay.hostId, stay.currency), cents(1_000)]]),
    );

    expect(left.get("mine")).toBe(1_000);
    expect(left.get("theirs")).toBe(NO_CENTS);
  });

  it("takes nothing for a standing reservation, whose withheld is on the fees already", () => {
    const fees = cents(3_000);
    const left = shareOutHostFees(
      [
        {
          booking: { ...stay, id: "reserved" },
          payout: {
            reservedCents: cents(10_000),
            feeWithheldCents: cents(2_000),
          },
        },
        stayOf("next"),
      ],
      new Map([[hostFeesKey(stay.hostId, stay.currency), fees]]),
    );

    expect(left.get("next")).toBe(fees);
  });

  it("hands an outgrown reservation's withheld back to the debt before it is shared on", () => {
    const share = owedToHost(stay);
    const withheld = cents(2_000);
    const fees = cents(share - 1_000);
    const left = shareOutHostFees(
      [
        {
          // A refund since left the reservation more than the stay owes.
          booking: { ...stay, id: "outgrown" },
          payout: { reservedCents: share, feeWithheldCents: withheld },
        },
        stayOf("next"),
      ],
      new Map([[hostFeesKey(stay.hostId, stay.currency), fees]]),
    );

    expect(left.get("outgrown")).toBe(fees);
    // The outgrown stay takes its whole share out of the debt and its withheld: 1 000 left.
    expect(left.get("next")).toBe(1_000);
  });
});
