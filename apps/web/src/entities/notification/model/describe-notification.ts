import {
  NotificationType,
  ReviewKind,
  StayParty,
  type Notification,
} from "@repo/contracts";
import { ROUTES } from "#shared/config";
import { filtersHref, formatDay } from "#shared/lib";

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
    default: {
      const unknown: never = notification;

      throw new Error(`Unknown notification ${JSON.stringify(unknown)}`);
    }
  }
}

function stayDates({ from, to }: { from: string; to: string }): string {
  return `${formatDay(from)} – ${formatDay(to)}`;
}

/** The stays screen narrowed to one listing — the link a host's card offers there too. */
function listingStays(listingId: string): string {
  return filtersHref(ROUTES.bookings, { listingId });
}
