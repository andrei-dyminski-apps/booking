import { describe, expect, it } from "vitest";
import { BookingStatus, Role } from "@repo/contracts";
import { cancellationRefundNote } from "./cancellation-refund";

const GUEST = { id: "guest", role: Role.USER };
const HOST = { id: "host", role: Role.USER };
const ADMIN = { id: "admin", role: Role.ADMIN };

const stay = {
  status: BookingStatus.CONFIRMED,
  amount: 361.05,
  refundedAmount: null,
  paid: true,
  dispute: null,
  from: "2026-11-10",
  guestId: GUEST.id,
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

  it("names no past date to a guest whose window has closed", () => {
    expect(cancellationRefundNote(stay, GUEST, OUTSIDE)).toBe(
      "The free cancellation window has closed: cancelling now refunds nothing.",
    );
  });

  it("tells an admin their cancellation refunds in full after the free window", () => {
    expect(cancellationRefundNote(stay, ADMIN, OUTSIDE)).toBe(
      "Cancelled by an admin, it refunds the stay in full.",
    );
  });

  it("promises only what a dashboard refund left of the payment", () => {
    expect(
      cancellationRefundNote({ ...stay, refundedAmount: 100 }, GUEST, INSIDE),
    ).toMatch(/refunds the remaining \$261\.05;/);
    expect(
      cancellationRefundNote(
        { ...stay, refundedAmount: 361.05 },
        ADMIN,
        INSIDE,
      ),
    ).toBe(
      "The stay has been refunded in full already: cancelling refunds nothing more.",
    );
  });

  it("counts a refund total a hair under the amount as the whole of it", () => {
    // 0.7 - 0.4 is 0.29999999999999993 in binary floating point.
    expect(
      cancellationRefundNote(
        { ...stay, amount: 0.3, refundedAmount: 0.7 - 0.4 },
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

  it("says nothing to a host, who is not offered the button, or of an unpaid stay", () => {
    expect(cancellationRefundNote(stay, HOST, INSIDE)).toBeNull();
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
