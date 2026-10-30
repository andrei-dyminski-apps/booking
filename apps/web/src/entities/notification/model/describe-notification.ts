import {
  NotificationType,
  ReviewKind,
  StayParty,
  type Notification,
} from "@repo/contracts";
import { ROUTES } from "#shared/config";
import { filtersHref, formatDay, formatMoney } from "#shared/lib";

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
        title: asGuest ? "Your stay was cancelled" : "A stay was cancelled",
        detail: `${data.listingTitle} · ${stayDates(data)}`,
        href: asGuest ? ROUTES.bookings : listingStays(data.listingId),
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
        detail: `${formatMoney(data.amount)} · ${data.listingTitle}`,
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
        detail: `${formatMoney(data.amount)} · ${data.listingTitle} · ${stayDates(data)}`,
        href: ROUTES.payouts,
      };
    }
    // The four below are told to every admin: money that waits for a person. The stay's
    // own page is where an admin reads its payment; a failure that names none has nowhere
    // on this site to lead, so it leads back to the feed.
    case NotificationType.REFUND_FAILED: {
      const { data } = notification;

      return {
        title: "A refund did not reach the guest",
        detail: `${formatMoney(data.amount)} · ${data.reason ?? "no reason given"} · ${data.refundId}`,
        href:
          data.bookingId === null
            ? ROUTES.notifications
            : ROUTES.booking(data.bookingId),
      };
    }
    case NotificationType.PAYMENT_EVENT_FAILED: {
      const { data } = notification;

      return {
        title: "A payment event was set aside",
        detail: `${data.eventType} · ${data.eventId} · ${data.error}`,
        href: ROUTES.notifications,
      };
    }
    case NotificationType.CANCELLATION_REFUND_FAILED: {
      const { data } = notification;

      return {
        title: "A cancellation's refund is stuck",
        detail: data.error,
        href: ROUTES.booking(data.bookingId),
      };
    }
    case NotificationType.PAYOUT_FAILED: {
      const { data } = notification;

      return {
        title: "A host's payout is stuck",
        detail: data.error,
        href: ROUTES.booking(data.bookingId),
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
