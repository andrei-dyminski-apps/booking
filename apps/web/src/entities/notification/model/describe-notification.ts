import {
  Canceller,
  HOST_CANCELLATIONS_WINDOW_DAYS,
  NotificationType,
  ReviewKind,
  StayParty,
  type Cents,
  type Currency,
  type Notification,
} from "@repo/contracts";
import { ROUTES, setAsideHref } from "#shared/config";
import { countOf, filtersHref, formatDay, formatMoney } from "#shared/lib";

/** A notification as a person reads it: what happened, the detail, and where to look. */
export type NotificationText = {
  title: string;
  detail: string;
  href: string;
};

/**
 * The wording of every kind, in one place, because two places draw it: the bell in the
 * shell and the feed's own page — and the toast that announces a new one. The API states
 * the facts and leaves the sentence to the screen, which is where a translation catalogue
 * will go when i18n arrives.
 *
 * The switch is exhaustive: a kind added to the contract stops compiling here instead of
 * reaching the screen as a blank row.
 */
export function describeNotification(
  notification: Notification,
): NotificationText {
  switch (notification.type) {
    case NotificationType.BOOKING_REQUESTED: {
      const { data } = notification;

      return {
        title: "New booking request",
        detail: `${data.listingTitle} · ${stayDates(data)}`,
        href: listingStays(data.listingId),
      };
    }
    case NotificationType.BOOKING_CANCELLED: {
      const { data } = notification;
      const asGuest = data.recipient === StayParty.GUEST;

      return {
        title: cancelledTitle(asGuest, data.cancelledBy),
        detail: [
          data.listingTitle,
          stayDates(data),
          ...(data.refundCents === null
            ? []
            : [cancellationRefund(data.refundCents, data.currency, asGuest)]),
          ...(data.reason === null ? [] : [`“${data.reason}”`]),
        ].join(" · "),
        // The guest to the stay's own page, as a confirmation does: the line above is cut to
        // one row, and the page is where who cancelled and why are said in full.
        href: asGuest
          ? ROUTES.booking(data.bookingId)
          : listingStays(data.listingId),
      };
    }
    case NotificationType.BOOKING_EXPIRED: {
      const { data } = notification;
      const asGuest = data.recipient === StayParty.GUEST;

      return {
        title: asGuest
          ? "Your booking request lapsed"
          : "A booking request lapsed",
        detail: `${data.listingTitle} · ${stayDates(data)}`,
        href: asGuest ? ROUTES.bookings : listingStays(data.listingId),
      };
    }
    case NotificationType.BOOKING_CONFIRMED: {
      const { data } = notification;
      const asGuest = data.recipient === StayParty.GUEST;

      return {
        title: asGuest ? "Your stay is confirmed" : "A stay was paid for",
        detail: `${data.listingTitle} · ${stayDates(data)}`,
        href: asGuest
          ? ROUTES.booking(data.bookingId)
          : listingStays(data.listingId),
      };
    }
    case NotificationType.PAYMENT_REFUNDED: {
      const { data } = notification;

      return {
        title: "Your payment was refunded",
        detail: `${formatMoney(data.amountCents, data.currency)} · ${data.listingTitle}`,
        href: ROUTES.booking(data.bookingId),
      };
    }
    case NotificationType.PAYMENT_DISPUTED: {
      const { data } = notification;

      return {
        title: "A payment was disputed",
        detail: `${data.listingTitle} · ${stayDates(data)} · the payout waits for the outcome`,
        href: ROUTES.booking(data.bookingId),
      };
    }
    case NotificationType.PAYOUT_SENT: {
      const { data } = notification;

      return {
        title: "You were paid for a stay",
        detail: [
          formatMoney(data.amountCents, data.currency),
          ...(data.withheldCents > 0
            ? [
                `${formatMoney(data.withheldCents, data.currency)} kept back for cancellation fees`,
              ]
            : []),
          data.listingTitle,
          stayDates(data),
        ].join(" · "),
        href: ROUTES.payouts,
      };
    }
    case NotificationType.HOST_CANCELLATION_FEE: {
      const { data } = notification;

      return {
        title: "Your cancellation costs a fee",
        detail: `${formatMoney(data.amountCents, data.currency)} · kept back from your next payouts · ${data.listingTitle} · ${stayDates(data)}`,
        href: ROUTES.payouts,
      };
    }
    // The four below are told to every admin: money that waits for a person. Each leads to
    // the tab of the admin's payments screen that lists it, filtered down to the row it is
    // about, where it is acted on — the stay is one link further, from the row.
    case NotificationType.REFUND_FAILED: {
      const { data } = notification;

      return {
        title: "A refund did not reach the guest",
        detail: `${formatMoney(data.amountCents, data.currency)} · ${data.reason ?? "no reason given"} · ${data.refundId}`,
        href: setAsideHref("bounced", { refundId: data.refundId }),
      };
    }
    case NotificationType.PAYMENT_EVENT_FAILED: {
      const { data } = notification;

      return {
        title: "A payment event was set aside",
        detail: `${data.eventType} · ${data.eventId} · ${data.error}`,
        href: setAsideHref("events", { eventId: data.eventId }),
      };
    }
    case NotificationType.CANCELLATION_REFUND_FAILED: {
      const { data } = notification;

      return {
        title: "A cancellation's refund is stuck",
        detail: data.error,
        href: setAsideHref("stuck-refunds", { bookingId: data.bookingId }),
      };
    }
    case NotificationType.PAYOUT_FAILED: {
      const { data } = notification;

      return {
        title: "A host's payout is stuck",
        detail: data.error,
        href: setAsideHref("stuck-payouts", { bookingId: data.bookingId }),
      };
    }
    case NotificationType.PAYOUT_SHORTFALL: {
      const { data } = notification;

      return {
        title: "A host was paid less than their payout reserved",
        detail: `${formatMoney(data.sentCents, data.currency)} sent of ${formatMoney(data.reservedCents, data.currency)} · the rest has to be sent outside the payout`,
        href: ROUTES.booking(data.bookingId),
      };
    }
    case NotificationType.HOST_CANCELLATIONS_THRESHOLD: {
      const { data } = notification;

      return {
        title: "A host keeps cancelling stays",
        detail: `${data.hostName} · ${countOf(data.cancellations, "paid stay")} cancelled in the last ${countOf(HOST_CANCELLATIONS_WINDOW_DAYS, "day")}`,
        href: ROUTES.adminUser(data.hostId),
      };
    }
    case NotificationType.REVIEW_RECEIVED: {
      const { data } = notification;
      const ofListing = data.kind === ReviewKind.LISTING;

      return {
        title: ofListing
          ? "A guest reviewed your listing"
          : "A host reviewed you",
        detail: `${String(data.rating)} of 5 stars · ${data.listingTitle}`,
        href: ofListing
          ? ROUTES.listing(data.listingId)
          : ROUTES.guestReviews(data.guestId),
      };
    }
    case NotificationType.WAITLIST_AVAILABLE: {
      const { data } = notification;

      return {
        title: "Nights you waited for are free",
        detail: `${data.listingTitle} · ${stayDates(data)} · first to book takes them`,
        href: ROUTES.listing(data.listingId),
      };
    }
    default: {
      const unknown: never = notification;

      throw new Error(`Unknown notification ${JSON.stringify(unknown)}`);
    }
  }
}

function stayDates({ from, to }: { from: string; to: string }): string {
  return `${formatDay(from)} – ${formatDay(to)}`;
}

/**
 * The host's side of the stays screen narrowed to one listing — the link a host's card
 * offers there too. The side has to be named: the guest's is the default, and a host's
 * own listing names nothing among their trips.
 */
function listingStays(listingId: string): string {
  return filtersHref(ROUTES.bookings, { side: StayParty.HOST, listingId });
}

/**
 * What a cancellation gives back, from the side of whoever reads it. Owed rather than sent:
 * a job sends it after the notice is written, so neither side is told it has gone back.
 */
function cancellationRefund(
  refundCents: Cents,
  currency: Currency,
  asGuest: boolean,
): string {
  if (refundCents === 0) return "no refund";

  const amount = formatMoney(refundCents, currency);

  return asGuest
    ? `${amount} coming back to you`
    : `${amount} going back to the guest`;
}

/** Who took the stay away, as the side told about it reads it. */
function cancelledTitle(
  asGuest: boolean,
  cancelledBy: Canceller | null,
): string {
  if (cancelledBy === Canceller.HOST && asGuest) {
    return "Your host cancelled your stay";
  }

  if (cancelledBy === Canceller.GUEST && !asGuest) {
    return "Your guest cancelled their stay";
  }

  if (cancelledBy === Canceller.ADMIN) {
    return asGuest
      ? "Your stay was cancelled by the site"
      : "A stay was cancelled by the site";
  }

  return asGuest ? "Your stay was cancelled" : "A stay was cancelled";
}
