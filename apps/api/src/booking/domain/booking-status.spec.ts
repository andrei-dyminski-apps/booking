import { BookingStatus } from "@repo/contracts";
import {
  ACTIVE_STATUSES,
  canTransition,
  holdExpiry,
  HOLD_TTL_MS,
  isCancellable,
} from "./booking-status";

describe("booking status rules", () => {
  it("counts only a hold and a confirmed stay as active", () => {
    expect([...ACTIVE_STATUSES].sort()).toEqual(
      [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED].sort(),
    );
  });

  it("places the hold deadline HOLD_TTL_MS after the given moment", () => {
    const now = new Date("2026-08-27T12:00:00.000Z");

    expect(holdExpiry(now).getTime()).toBe(now.getTime() + HOLD_TTL_MS);
  });

  describe("canTransition", () => {
    it("lets a hold be paid, cancelled or expired", () => {
      for (const to of [
        BookingStatus.CONFIRMED,
        BookingStatus.CANCELLED,
        BookingStatus.EXPIRED,
      ]) {
        expect(canTransition(BookingStatus.PENDING_PAYMENT, to)).toBe(true);
      }
    });

    it("lets a confirmed stay only be cancelled", () => {
      expect(
        canTransition(BookingStatus.CONFIRMED, BookingStatus.CANCELLED),
      ).toBe(true);
      expect(
        canTransition(BookingStatus.CONFIRMED, BookingStatus.EXPIRED),
      ).toBe(false);
      expect(
        canTransition(BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT),
      ).toBe(false);
    });

    it("treats CANCELLED and EXPIRED as terminal", () => {
      for (const from of [BookingStatus.CANCELLED, BookingStatus.EXPIRED]) {
        for (const to of Object.values(BookingStatus)) {
          expect(canTransition(from, to)).toBe(false);
        }
      }
    });
  });

  it("reports a hold and a confirmed stay as cancellable, the terminal ones not", () => {
    expect(isCancellable(BookingStatus.PENDING_PAYMENT)).toBe(true);
    expect(isCancellable(BookingStatus.CONFIRMED)).toBe(true);
    expect(isCancellable(BookingStatus.CANCELLED)).toBe(false);
    expect(isCancellable(BookingStatus.EXPIRED)).toBe(false);
  });
});
