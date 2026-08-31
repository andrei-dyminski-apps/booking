import Link from "next/link";
import { CalendarIcon, MoonIcon } from "lucide-react";
import { BookingStatus, Role, type Booking, type User } from "@repo/contracts";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ROUTES } from "#shared/config";
import {
  countOf,
  formatDay,
  formatMoment,
  formatMoney,
  nightsBetween,
} from "#shared/lib";
import { ButtonLink } from "#shared/ui";
import { listingStaysHref } from "../lib/bookings-search";
import { BookingStatusBadge } from "./booking-status-badge";
import { CancelBookingButton } from "./cancel-booking-button";

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
}: {
  booking: Booking;
  viewer: User;
}) => {
  const nights = nightsBetween(booking.from, booking.to);

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
          <span className="flex items-center gap-1.5">
            <CalendarIcon className="size-3.5" />
            {formatDay(booking.from)} → {formatDay(booking.to)}
          </span>
          <span className="flex items-center gap-1.5">
            <MoonIcon className="size-3.5" />
            {countOf(nights, "night")}
          </span>
          {/*
            What these nights cost today, which is not the same claim as what this stay
            cost. The nightly price is read off the listing as it stands now — a booking
            carries no amount of its own until the payment step of phase 6 puts one there
            — so an owner who has since changed the price would otherwise have every past
            stay silently restated at the new one.
          */}
          <span className="font-medium text-foreground">
            {formatMoney(nights * booking.listing.pricePerNight)} at the current
            rate
          </span>
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          {/*
            The stays against one listing, for the two roles that see more than their own.
            It is how the `listingId` filter is reached in practice — the id is in the URL
            it writes rather than typed into the box behind the dialog — and a guest is not
            offered it because their own list is already one person's.
          */}
          {viewer.role !== Role.USER && (
            <ButtonLink
              href={listingStaysHref(booking.listingId)}
              variant="ghost"
              size="sm"
            >
              Stays here
            </ButtonLink>
          )}
          <BookingStatusBadge status={booking.status} />
          {mayCancel(booking, viewer) && (
            <CancelBookingButton
              bookingId={booking.id}
              listingId={booking.listingId}
            />
          )}
        </CardAction>
      </CardHeader>

      {booking.status === BookingStatus.PENDING_PAYMENT &&
        booking.expiresAt !== null && (
          <CardContent>
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              The hold lasts until {formatMoment(booking.expiresAt)} UTC. There
              is nothing to pay with yet, so it lapses then and the nights go
              back on offer.
            </p>
          </CardContent>
        )}
    </Card>
  );
};

/**
 * Whether the button is worth offering, which is not the same as whether it is allowed:
 * the API decides that on every request — the guest and an admin may cancel, the owner of
 * the listing may read the stay and not cancel it — and a button rendered by mistake would
 * reach a `403` rather than a cancelled booking.
 *
 * The status half is the same rule read from this side: only a stay that still holds its
 * slot can be let go of, and cancelling one that no longer does is the `404` the
 * repository answers by narrowing to the active set.
 */
function mayCancel(booking: Booking, viewer: User): boolean {
  const active =
    booking.status === BookingStatus.PENDING_PAYMENT ||
    booking.status === BookingStatus.CONFIRMED;

  return (
    active && (viewer.role === Role.ADMIN || viewer.id === booking.guestId)
  );
}
