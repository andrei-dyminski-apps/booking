import Link from "next/link";
import { Role } from "@repo/contracts";
import { awaitsPaymentFrom } from "#entities/booking";
import { bookingsApi, requireUser } from "#shared/api";
import { ROUTES, stripePublishableKey } from "#shared/config";
import { orNotFound, requireId, singleParam } from "#shared/lib";
import { BackLink, PageHeading } from "#shared/ui";
import { readBookingAdjustments } from "../api/read-booking-adjustments";
import { BookingLive, type BankAnswer } from "./booking-live";

/**
 * One stay: what it costs, where it stands, and — for the guest of a hold — the form that
 * pays for it. It is where a new hold lands (`createBookingAction` redirects here) and where
 * a card with a step at the bank comes back to, with Stripe's `redirect_status` in the URL.
 *
 * Who may read it is the API's answer, as on the list: the guest, the host and an admin, and
 * a `404` for everybody else. The payment itself is opened by the form in the browser
 * (`POST /bookings/:id/payment`), not by this render: a render must not open anything at
 * Stripe, and it runs again on every refresh.
 */
export const BookingPage = async ({
  params,
  searchParams,
}: PageProps<"/bookings/[id]">) => {
  const id = requireId((await params).id);
  const viewer = await requireUser(ROUTES.booking(id));
  // The refunds admins sent are an admin's to read, as the route behind them is; asked for
  // beside the stay and outside `orNotFound`: a failure of theirs is drawn as a line in
  // their place rather than taking the stay down — see `readBookingAdjustments`.
  const [booking, adjustments] = await Promise.all([
    orNotFound(bookingsApi.get(id, { cache: "no-store" })),
    viewer.role === Role.ADMIN ? readBookingAdjustments(id) : [],
  ]);
  const redirectStatus = singleParam((await searchParams).redirect_status);
  const now = new Date().toISOString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <BackLink href={ROUTES.bookings}>Stays</BackLink>
        {/* The place names the page; the card under it names the stay — its dates. */}
        <PageHeading
          title={
            <Link
              href={ROUTES.listing(booking.listingId)}
              className="hover:underline"
            >
              {booking.listing.title}
            </Link>
          }
          description="What the stay costs, where it stands, and what cancelling it would give back."
        />
      </div>

      <BookingLive
        initial={booking}
        viewer={viewer}
        now={now}
        // Whether to offer the form at all: the API decides it again when the form asks for
        // the payment, so this only spares a form that is bound to be refused.
        publishableKey={
          awaitsPaymentFrom(booking, viewer, now)
            ? stripePublishableKey()
            : null
        }
        bankAnswer={bankAnswerOf(redirectStatus)}
        adjustments={adjustments}
      />
    </div>
  );
};

/**
 * Stripe's `redirect_status`, as the page acts on it. Anything but these is no answer at
 * all — the visitor did not come back from a bank.
 *
 * `processing` is read as paid, which takes the payment form away until the webhook, and
 * that holds only because the API opens the intent with instant methods alone
 * (`INSTANT_PAYMENT_METHODS` in `apps/api`): for them `processing` is a moment before
 * `succeeded`. A method that settles over days could still fail after it, and the guest
 * would be left without the form for the rest of the hold — adding one to that list means
 * changing this, and `PAID` in `payment-form.tsx`, first.
 */
function bankAnswerOf(redirectStatus: string): BankAnswer | null {
  switch (redirectStatus) {
    case "succeeded":
    case "processing":
      return "paid";
    case "failed":
      return "declined";
    default:
      return null;
  }
}
