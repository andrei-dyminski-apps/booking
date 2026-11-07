import { describe, expect, it } from "vitest";
import {
  BookingStatus,
  CURRENCY,
  cents,
  DisputeStatus,
  Role,
} from "@repo/contracts";
import { cancellationRefundNote } from "./cancellation-refund";

const GUEST = { id: "guest", role: Role.USER };
const HOST = { id: "host", role: Role.USER };
const ADMIN = { id: "admin", role: Role.ADMIN };

const stay = {
  status: BookingStatus.CONFIRMED,
  amountCents: cents(36_105),
  currency: CURRENCY,
  refundedAmountCents: null,
  paid: true,
  dispute: null,
  from: "2026-11-10",
  guestId: GUEST.id,
  hostId: HOST.id,
  // Booked long before, so the grace period is over.
  createdAt: "2026-09-01T12:00:00.000Z",
  cancellationPolicy: "FLEXIBLE" as const,
};

/** Two days before midnight UTC of the check-in, less and more an hour. */
const INSIDE = "2026-11-07T23:00:00.000Z";
const OUTSIDE = "2026-11-08T01:00:00.000Z";

describe("cancellationRefundNote", () => {
  it("names the end of the free window to a guest still inside it", () => {
    expect(cancellationRefundNote(stay, GUEST, INSIDE)).toMatch(
      /^Cancelling before .+ UTC refunds the stay in full/,
    );
  });

  it("tells a guest whose windows have all closed that nothing comes back", () => {
    expect(cancellationRefundNote(stay, GUEST, OUTSIDE)).toBe(
      "Every refund window has closed: cancelling now refunds nothing.",
    );
  });

  it("words a partial share, when it falls, and what waiting cost", () => {
    // LIMITED: full until 14 days before check-in, half until 7.
    const limited = { ...stay, cancellationPolicy: "LIMITED" as const };

    expect(
      cancellationRefundNote(limited, GUEST, "2026-11-01T12:00:00.000Z"),
    ).toBe(
      "Cancelling before 3 Nov 2026, 00:00 UTC refunds 50% ($180.53); after that, nothing comes back. Before 27 Oct 2026, 00:00 UTC it would have been the full amount.",
    );
  });

  it("does not set a partial share beside an amount a dashboard refund has lowered", () => {
    // 50% of $361.05 rounds half up to $180.53; less $100.00 refunded it is $80.53.
    const limited = {
      ...stay,
      cancellationPolicy: "LIMITED" as const,
      refundedAmountCents: cents(10_000),
    };

    expect(
      cancellationRefundNote(limited, GUEST, "2026-11-01T12:00:00.000Z"),
    ).toMatch(
      /^Cancelling before 3 Nov 2026, 00:00 UTC refunds \$80\.53 \(50% of the stay, \$180\.53, less the \$100\.00 refunded already\); after that/,
    );
  });

  it("tells a guest of a non-refundable stay that nothing ever comes back", () => {
    expect(
      cancellationRefundNote(
        { ...stay, cancellationPolicy: "NON_REFUNDABLE" },
        GUEST,
        INSIDE,
      ),
    ).toBe("This stay is non-refundable: cancelling refunds nothing.");
  });

  it("tells a stay booked after its windows closed it never had one, not that it is non-refundable", () => {
    // MODERATE, booked 3 days before check-in: its 5-day window had closed already.
    expect(
      cancellationRefundNote(
        {
          ...stay,
          cancellationPolicy: "MODERATE",
          createdAt: "2026-11-07T00:00:00.000Z",
        },
        GUEST,
        "2026-11-07T01:00:00.000Z",
      ),
    ).toBe(
      "This stay was booked too close to check-in for a refund: cancelling refunds nothing.",
    );
  });

  it("tells an admin their cancellation refunds in full after every window closed", () => {
    expect(cancellationRefundNote(stay, ADMIN, OUTSIDE)).toBe(
      "Cancelled by an admin, it refunds the stay in full.",
    );
  });

  it("promises only what a dashboard refund left of the payment", () => {
    expect(
      cancellationRefundNote(
        { ...stay, refundedAmountCents: cents(10_000) },
        GUEST,
        INSIDE,
      ),
    ).toMatch(/refunds the remaining \$261\.05;/);
    expect(
      cancellationRefundNote(
        { ...stay, refundedAmountCents: cents(36_105) },
        ADMIN,
        INSIDE,
      ),
    ).toBe(
      "The stay has been refunded in full already: cancelling refunds nothing more.",
    );
  });

  it("counts a refund total past the amount as the whole of it, never a negative rest", () => {
    expect(
      cancellationRefundNote(
        { ...stay, refundedAmountCents: cents(36_106) },
        GUEST,
        INSIDE,
      ),
    ).toBe(
      "The stay has been refunded in full already: cancelling refunds nothing more.",
    );
  });

  it("promises nothing the bank has already given back", () => {
    expect(
      cancellationRefundNote({ ...stay, dispute: "LOST" }, ADMIN, INSIDE),
    ).toMatch(/cancelling refunds nothing more\.$/);
  });

  it("says nothing of a stay that has begun, which nobody may cancel", () => {
    const checkIn = "2026-11-10T08:00:00.000Z";

    expect(cancellationRefundNote(stay, GUEST, checkIn)).toBeNull();
    expect(cancellationRefundNote(stay, ADMIN, checkIn)).toBeNull();
  });

  it("tells the host the guest gets everything back and what the fee of the window costs", () => {
    // Inside the last 48 hours: half the stay; an hour before them, a quarter.
    expect(cancellationRefundNote(stay, HOST, OUTSIDE)).toBe(
      "If you cancel now, the guest is refunded in full and you pay a fee of $180.53 (50% of what it refunds), kept back from your next payouts.",
    );
    expect(cancellationRefundNote(stay, HOST, INSIDE)).toMatch(
      /a fee of \$90\.26 \(25% of what it refunds\)/,
    );
    expect(
      cancellationRefundNote(stay, HOST, "2026-10-01T00:00:00.000Z"),
    ).toMatch(/a fee of \$36\.11 \(10% of what it refunds\)/);
    expect(
      cancellationRefundNote(
        { ...stay, status: BookingStatus.PENDING_PAYMENT },
        HOST,
        INSIDE,
      ),
    ).toBe(
      "Nobody has paid for this request yet, so declining it costs you nothing.",
    );
  });

  it("charges the host a share of what is left to refund, and nothing when nothing is", () => {
    expect(
      cancellationRefundNote(
        { ...stay, refundedAmountCents: cents(16_105) },
        HOST,
        OUTSIDE,
      ),
    ).toMatch(/a fee of \$100\.00 \(50% of what it refunds\)/);
    expect(
      cancellationRefundNote(
        { ...stay, refundedAmountCents: stay.amountCents },
        HOST,
        OUTSIDE,
      ),
    ).toBe(
      "The stay has been refunded in full already: cancelling refunds nothing more and costs you nothing.",
    );
    expect(
      cancellationRefundNote(
        { ...stay, dispute: DisputeStatus.LOST },
        HOST,
        OUTSIDE,
      ),
    ).toBe(
      "The bank has returned the payment after a dispute: cancelling refunds nothing and costs you nothing.",
    );
  });

  it("says nothing to the host of a stay nobody paid for", () => {
    expect(
      cancellationRefundNote({ ...stay, paid: false }, HOST, OUTSIDE),
    ).toBeNull();
  });

  it("says nothing of an unpaid stay", () => {
    expect(
      cancellationRefundNote({ ...stay, paid: false }, ADMIN, INSIDE),
    ).toBeNull();
    expect(
      cancellationRefundNote(
        { ...stay, status: BookingStatus.PENDING_PAYMENT },
        GUEST,
        INSIDE,
      ),
    ).toBeNull();
  });
});
