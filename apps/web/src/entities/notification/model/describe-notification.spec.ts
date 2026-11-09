import { describe, expect, it } from "vitest";
import {
  CURRENCY,
  cents,
  NotificationType,
  StayParty,
  type Cents,
} from "@repo/contracts";
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
      data: {
        ...stay,
        amountCents: cents(32_495),
        withheldCents: cents(0),
        currency: CURRENCY,
      },
    });

    expect(refunded.detail).toMatch(/^.*361\.05 · Cabin by the lake$/);
    expect(refunded.href).toBe(`/bookings/${BOOKING_ID}`);
    expect(paidOut.detail).toContain("324.95");
    expect(paidOut.href).toBe("/dashboard/payouts");
  });

  it("says what a cancellation gives back, from the side of whoever reads it", () => {
    const cancelled = (
      recipient: StayParty,
      refundCents: ReturnType<typeof cents> | null,
    ) =>
      describeNotification({
        ...stored,
        type: NotificationType.BOOKING_CANCELLED,
        data: {
          ...stay,
          recipient,
          refundCents,
          currency: CURRENCY,
          cancelledBy: null,
          reason: null,
        },
      }).detail;

    expect(cancelled(StayParty.GUEST, cents(18_053))).toMatch(
      /180\.53 coming back to you$/,
    );
    expect(cancelled(StayParty.HOST, cents(18_053))).toMatch(
      /180\.53 going back to the guest$/,
    );
    expect(cancelled(StayParty.GUEST, cents(0))).toMatch(/ · no refund$/);
    expect(cancelled(StayParty.HOST, null)).toMatch(
      /Cabin by the lake · [^·]+$/,
    );
  });

  it("tells the host a guest is leaving early, with the new check-out and the refund", () => {
    const ended = (
      recipient: StayParty,
      endedBy: "GUEST" | "ADMIN",
      refundCents: Cents | null,
    ) =>
      describeNotification({
        ...stored,
        type: NotificationType.STAY_ENDED_EARLY,
        data: {
          ...stay,
          checkOut: stay.from,
          recipient,
          endedBy,
          refundCents,
          currency: CURRENCY,
        },
      });

    expect(ended(StayParty.HOST, "GUEST", cents(24_070))).toMatchObject({
      title: "Your guest is leaving early",
      detail: expect.stringMatching(
        / · now .+ · \$240\.70 going back to the guest$/,
      ) as unknown,
    });
    expect(ended(StayParty.GUEST, "ADMIN", cents(0))).toMatchObject({
      title: "Your stay was ended early by the site",
      detail: expect.stringMatching(/ · no refund$/) as unknown,
    });
    expect(ended(StayParty.HOST, "ADMIN", null).detail).toMatch(
      /Cabin by the lake · now [^·]+$/,
    );
  });

  it("tells each side the other cancelled, the guest why, and the host what it costs", () => {
    const byHost = describeNotification({
      ...stored,
      type: NotificationType.BOOKING_CANCELLED,
      data: {
        ...stay,
        recipient: StayParty.GUEST,
        refundCents: cents(36_105),
        currency: CURRENCY,
        cancelledBy: "HOST",
        reason: "A pipe burst",
      },
    });
    const fee = describeNotification({
      ...stored,
      type: NotificationType.HOST_CANCELLATION_FEE,
      data: {
        ...stay,
        feeId: BOOKING_ID,
        amountCents: cents(3_611),
        currency: CURRENCY,
      },
    });
    const kept = describeNotification({
      ...stored,
      type: NotificationType.PAYOUT_SENT,
      data: {
        ...stay,
        amountCents: cents(20_000),
        withheldCents: cents(3_611),
        currency: CURRENCY,
      },
    });

    const byGuest = describeNotification({
      ...stored,
      type: NotificationType.BOOKING_CANCELLED,
      data: {
        ...stay,
        recipient: StayParty.HOST,
        refundCents: null,
        currency: CURRENCY,
        cancelledBy: "GUEST",
        reason: null,
      },
    });

    expect(byHost.title).toBe("Your host cancelled your stay");
    expect(byGuest.title).toBe("Your guest cancelled their stay");
    expect(byHost.detail).toMatch(/ · “A pipe burst”$/);
    expect(byHost.href).toBe(`/bookings/${BOOKING_ID}`);
    expect(fee.detail).toMatch(/^\$36\.11 · kept back from your next payouts/);
    expect(fee.href).toBe("/dashboard/payouts");
    expect(kept.detail).toContain("$36.11 kept back for cancellation fees");
  });

  it("leads the admins to a host who keeps cancelling", () => {
    const host = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";

    expect(
      describeNotification({
        ...stored,
        type: NotificationType.HOST_CANCELLATIONS_THRESHOLD,
        data: { hostId: host, hostName: "Harbour Host", cancellations: 3 },
      }),
    ).toEqual({
      title: "A host keeps cancelling stays",
      detail: "Harbour Host · 3 paid stays cancelled in the last 365 days",
      href: `/admin/users/${host}`,
    });
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

  it("tells the admins a host's payout fell short, and leads them to the stay", () => {
    const shortfall = describeNotification({
      ...stored,
      type: NotificationType.PAYOUT_SHORTFALL,
      data: {
        bookingId: BOOKING_ID,
        reservedCents: cents(30_000),
        sentCents: cents(20_000),
        currency: CURRENCY,
      },
    });

    expect(shortfall.title).toBe(
      "A host was paid less than their payout reserved",
    );
    expect(shortfall.detail).toMatch(/200\.00.* sent of .*300\.00/);
    expect(shortfall.href).toBe(`/bookings/${BOOKING_ID}`);
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
