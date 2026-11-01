import { describe, expect, it } from "vitest";
import { CURRENCY, cents, NotificationType, StayParty } from "@repo/contracts";
import { describeNotification } from "./describe-notification";

/**
 * The money notices: who each one is addressed to decides its title and where it leads, and
 * a link that names a row nobody can open is the one mistake a reader cannot recover from.
 */

const BOOKING_ID = "11111111-1111-4111-8111-111111111111";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";

const stored = {
  id: "33333333-3333-4333-8333-333333333333",
  readAt: null,
  createdAt: "2026-11-01T12:00:00.000Z",
};

const stay = {
  bookingId: BOOKING_ID,
  listingId: LISTING_ID,
  listingTitle: "Cabin by the lake",
  from: "2026-11-10",
  to: "2026-11-13",
};

describe("describeNotification", () => {
  it("sends the guest of a confirmed stay to its page, and the host to the listing's stays", () => {
    const asGuest = describeNotification({
      ...stored,
      type: NotificationType.BOOKING_CONFIRMED,
      data: { ...stay, recipient: StayParty.GUEST },
    });
    const asHost = describeNotification({
      ...stored,
      type: NotificationType.BOOKING_CONFIRMED,
      data: { ...stay, recipient: StayParty.HOST },
    });

    expect(asGuest.title).toBe("Your stay is confirmed");
    expect(asGuest.href).toBe(`/bookings/${BOOKING_ID}`);
    expect(asHost.title).toBe("A stay was paid for");
    expect(asHost.href).toContain(`listingId=${LISTING_ID}`);
    expect(asHost.href).toContain("side=HOST");
  });

  it("names the amount of a refund and of a payout, and where each is read", () => {
    const refunded = describeNotification({
      ...stored,
      type: NotificationType.PAYMENT_REFUNDED,
      data: { ...stay, amountCents: cents(36_105), currency: CURRENCY },
    });
    const paidOut = describeNotification({
      ...stored,
      type: NotificationType.PAYOUT_SENT,
      data: { ...stay, amountCents: cents(32_495), currency: CURRENCY },
    });

    expect(refunded.detail).toMatch(/^.*361\.05 · Cabin by the lake$/);
    expect(refunded.href).toBe(`/bookings/${BOOKING_ID}`);
    expect(paidOut.detail).toContain("324.95");
    expect(paidOut.href).toBe("/dashboard/payouts");
  });

  it("leads a bounced refund to its own row on the payments screen, whether or not a stay names it", () => {
    const failed = (bookingId: string | null) =>
      describeNotification({
        ...stored,
        type: NotificationType.REFUND_FAILED,
        data: {
          refundId: "re_1",
          paymentId: "pi_1",
          bookingId,
          amountCents: cents(12_000),
          currency: CURRENCY,
          reason: null,
        },
      });

    expect(failed(BOOKING_ID).href).toBe(
      "/admin/payments?list=bounced&refundId=re_1",
    );
    expect(failed(BOOKING_ID).detail).toContain("no reason given");
    expect(failed(null).href).toBe(
      "/admin/payments?list=bounced&refundId=re_1",
    );
  });

  it("leads stuck money and a set-aside event to their own rows on the payments screen", () => {
    expect(
      describeNotification({
        ...stored,
        type: NotificationType.PAYOUT_FAILED,
        data: { bookingId: BOOKING_ID, error: "insufficient balance" },
      }),
    ).toEqual({
      title: "A host's payout is stuck",
      detail: "insufficient balance",
      href: `/admin/payments?list=stuck-payouts&bookingId=${BOOKING_ID}`,
    });
    expect(
      describeNotification({
        ...stored,
        type: NotificationType.CANCELLATION_REFUND_FAILED,
        data: { bookingId: BOOKING_ID, error: "card_declined" },
      }).href,
    ).toBe(`/admin/payments?list=stuck-refunds&bookingId=${BOOKING_ID}`);
    expect(
      describeNotification({
        ...stored,
        type: NotificationType.PAYMENT_EVENT_FAILED,
        data: {
          eventId: "evt_1",
          eventType: "charge.refunded",
          error: "timeout",
        },
      }).href,
    ).toBe("/admin/payments?eventId=evt_1");
  });
});
