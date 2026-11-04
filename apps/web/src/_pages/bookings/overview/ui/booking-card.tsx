import Link from "next/link";
import {
  BookingStatus,
  cancellerOf,
  isReviewable,
  Role,
  StayParty,
  type Booking,
  type User,
} from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { cancellationRefundNote, mayCancel } from "#features/cancel-booking";
import {
  awaitsPaymentFrom,
  BookingStatusBadge,
  CANCELLER_NAMES,
} from "#entities/booking";
import { ROUTES } from "#shared/config";
import { formatMoment, formatMoney } from "#shared/lib";
import { ButtonLink, DateRange, NightCount } from "#shared/ui";
import { listingStaysHref } from "../lib/bookings-search";
import { CancelBookingButton } from "./cancel-booking-button";
import { ReviewBookingButton } from "./review-booking-button";

/**
 * One stay. The listing it names comes on the booking itself rather than from a second
 * read, and that is not an optimization: retiring a listing keeps the row precisely so a
 * stay can go on saying where it was, but `GET /listings/:id` answers `404` for a retired
 * one to everybody — so the title below is the only thing that resolves it.
 *
 * The link to the listing is therefore offered without a promise: it leads to the
 * catalogue page, which is a 404 for a listing that has since been retired.
 */
export const BookingCard = ({
  booking,
  viewer,
  side,
  today,
  now,
}: {
  booking: Booking;
  viewer: User;
  /**
   * The half of a user's stays the page is drawing — on the host's side every stay is
   * against the viewer's own listing — or `null` for an admin, whose scope has no halves.
   */
  side: StayParty | null;
  /** Today in UTC, from the server — the day `isReviewable` compares the check-out to. */
  today: string;
  /** The server's clock at the render: the offer to cancel, its refund, a hold's deadline. */
  now: string;
}) => {
  const review = reviewHalf(booking, viewer, side, today);
  // A host and an admin see other people's stays; on the guest's side the list is one
  // person's, the viewer's own.
  const ofOthers = side !== StayParty.GUEST;
  // A hold past its deadline waits only for the sweep: "Pay" would open a form the API
  // refuses, so it reads "Details" like any other stay.
  const awaitsPayment = awaitsPaymentFrom(booking, viewer, now);
  const canceller = cancellerOf(booking, viewer);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Link
            href={ROUTES.listing(booking.listingId)}
            className="hover:underline"
          >
            {booking.listing.title}
          </Link>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <DateRange from={booking.from} to={booking.to} />
          <NightCount from={booking.from} to={booking.to} />
          {/*
            What this stay costs, as the API quoted it when the hold was taken — the amount
            the payment charges, and one an owner's later change of price does not restate.
          */}
          <span className="font-medium text-foreground">
            {formatMoney(booking.amountCents, booking.currency)}
          </span>
          {booking.refundedAmountCents !== null && (
            <span>
              {formatMoney(booking.refundedAmountCents, booking.currency)}{" "}
              refunded
            </span>
          )}
          {booking.refundOwedCents !== null && (
            <span>
              {formatMoney(booking.refundOwedCents, booking.currency)} refund on
              its way
            </span>
          )}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <BookingStatusBadge status={booking.status} />
          {/* Read with the badge: "Cancelled by the host". */}
          {booking.cancelledBy !== null && (
            <span className="text-sm text-muted-foreground">
              by {CANCELLER_NAMES[booking.cancelledBy]}
            </span>
          )}
          {review === "written" && <Badge variant="outline">Reviewed</Badge>}
        </CardAction>
      </CardHeader>

      {booking.status === BookingStatus.PENDING_PAYMENT &&
        booking.expiresAt !== null && (
          <CardContent>
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              The hold lasts until {formatMoment(booking.expiresAt)} UTC. Unpaid
              by then, it lapses and the nights go back on offer.
            </p>
          </CardContent>
        )}

      {/*
        What may be done with the stay, under it rather than beside the title: up to five
        controls, which a corner of the header has no room to wrap.
      */}
      <CardFooter className="flex-wrap gap-2">
        {/*
          The stay's own page: where its guest pays for a hold, and where anybody who may
          read it follows the payment through. Worded by what the guest still has to do.
        */}
        <ButtonLink
          href={ROUTES.booking(booking.id)}
          variant={awaitsPayment ? "default" : "outline"}
          size="sm"
        >
          {awaitsPayment ? "Pay" : "Details"}
        </ButtonLink>
        {review === "listing" && (
          <ReviewBookingButton
            bookingId={booking.id}
            listingId={booking.listingId}
            about="listing"
          />
        )}
        {review === "guest" && (
          <ReviewBookingButton
            bookingId={booking.id}
            listingId={null}
            about="guest"
          />
        )}
        {canceller !== null && mayCancel(booking, viewer, now) && (
          <CancelBookingButton
            bookingId={booking.id}
            listingId={booking.listingId}
            status={booking.status}
            canceller={canceller}
            refundNote={cancellationRefundNote(booking, viewer, now)}
          />
        )}
        {/*
          The stays against one listing, for a host and an admin, who see more than their
          own. It is how the `listingId` filter is reached in practice — the id is in the
          URL it writes rather than typed into the box behind the dialog — and the guest's
          side is not offered it because that list is already one person's.
        */}
        {ofOthers && (
          <ButtonLink
            href={listingStaysHref(booking.listingId, side ?? StayParty.GUEST)}
            variant="ghost"
            size="sm"
          >
            Stays here
          </ButtonLink>
        )}
        {/*
          What other hosts said about this guest, for the two the API lets read it from
          here: the host the guest asked to stay with, and an admin. A guest reads their
          own from the profile.
        */}
        {ofOthers && (
          <ButtonLink
            href={ROUTES.guestReviews(booking.guestId)}
            variant="ghost"
            size="sm"
          >
            Guest reviews
          </ButtonLink>
        )}
      </CardFooter>
    </Card>
  );
};

/**
 * Which half of the stay this viewer could write, if any — `written` once they have. The
 * guest writes about the listing and the host about the guest, which is the same rule the
 * API reads off the rows: the guest by the id, and the host by owning the listing — which
 * every stay on the host's side of the page is against. An admin reads every stay and
 * writes neither half, so they are offered nothing. Like the "Cancel" below, it offers rather
 * than permits: the API refuses a review of somebody else's stay whatever was drawn here.
 */
function reviewHalf(
  booking: Booking,
  viewer: User,
  side: StayParty | null,
  today: string,
): "listing" | "guest" | "written" | null {
  const half =
    viewer.role !== Role.ADMIN && viewer.id === booking.guestId
      ? { kind: "listing" as const, done: booking.reviewed.byGuest }
      : side === StayParty.HOST
        ? { kind: "guest" as const, done: booking.reviewed.byOwner }
        : null;

  if (half === null) return null;
  if (half.done) return "written";

  return isReviewable(booking, today) ? half.kind : null;
}
