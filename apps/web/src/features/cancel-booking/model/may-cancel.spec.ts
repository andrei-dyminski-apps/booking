import { describe, expect, it } from "vitest";
import { BookingStatus, DisputeStatus, Role } from "@repo/contracts";
import { mayCancel } from "./may-cancel";

const GUEST = { id: "guest", role: Role.USER };
const HOST = { id: "host", role: Role.USER };
const ADMIN = { id: "admin", role: Role.ADMIN };

const hold = {
  status: BookingStatus.PENDING_PAYMENT,
  from: "2026-11-10",
  timeZone: "UTC",
  checkInTime: "00:00",
  endedEarlyAt: null,
  expiresAt: "2026-11-01T12:15:00.000Z",
  dispute: null,
  guestId: GUEST.id,
  hostId: HOST.id,
};

const STRANGER = { id: "stranger", role: Role.USER };

const stay = { ...hold, status: BookingStatus.CONFIRMED };

describe("mayCancel", () => {
  it("offers a hold to its guest, its host and an admin until its deadline, and not after it", () => {
    const before = "2026-11-01T12:14:59.000Z";

    expect(mayCancel(hold, GUEST, before)).toBe(true);
    expect(mayCancel(hold, ADMIN, before)).toBe(true);
    expect(mayCancel(hold, HOST, before)).toBe(true);
    expect(mayCancel(hold, STRANGER, before)).toBe(false);
    expect(mayCancel(hold, GUEST, hold.expiresAt)).toBe(false);
  });

  it("offers the host a confirmed stay until its check-in day, as everybody else", () => {
    expect(mayCancel(stay, HOST, "2026-11-09T23:59:59.000Z")).toBe(true);
    expect(mayCancel(stay, HOST, "2026-11-10T00:00:00.000Z")).toBe(false);
  });

  it("offers a confirmed stay until its check-in day, the deadline of its hold long past", () => {
    expect(mayCancel(stay, GUEST, "2026-11-09T23:59:59.000Z")).toBe(true);
    expect(mayCancel(stay, ADMIN, "2026-11-10T00:00:00.000Z")).toBe(false);
  });

  it("offers a confirmed stay until the check-in time on the listing's clock, not the UTC day", () => {
    // 15:00 in Honolulu (UTC−10) on the 10th is 01:00 UTC on the 11th.
    const honolulu = {
      ...stay,
      timeZone: "Pacific/Honolulu",
      checkInTime: "15:00",
    };

    expect(mayCancel(honolulu, GUEST, "2026-11-11T00:59:59.000Z")).toBe(true);
    expect(mayCancel(honolulu, GUEST, "2026-11-11T01:00:00.000Z")).toBe(false);
  });

  it("does not offer a stay ended early, whatever its dates say", () => {
    expect(
      mayCancel(
        { ...stay, endedEarlyAt: "2026-11-01T09:00:00.000Z" },
        GUEST,
        "2026-11-01T10:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("does not offer a stay whose payment is disputed until the bank decides", () => {
    const now = "2026-11-05T00:00:00.000Z";

    expect(
      mayCancel({ ...stay, dispute: DisputeStatus.OPEN }, ADMIN, now),
    ).toBe(false);
    expect(mayCancel({ ...stay, dispute: DisputeStatus.WON }, GUEST, now)).toBe(
      true,
    );
  });

  it("offers nothing that no longer holds its nights", () => {
    const now = "2026-11-01T12:00:00.000Z";

    expect(
      mayCancel({ ...hold, status: BookingStatus.CANCELLED }, GUEST, now),
    ).toBe(false);
    expect(
      mayCancel({ ...hold, status: BookingStatus.EXPIRED }, ADMIN, now),
    ).toBe(false);
  });
});
