"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import {
  BookingStatus,
  Canceller,
  cancellerOf,
  DisputeStatus,
  isCancellableOn,
  mayEndEarly,
  NO_CENTS,
  refundableCents,
  Role,
  type BookingAdjustment,
  type BookingDetail,
  type User,
} from "@repo/contracts";
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
  BookingStatusBadge,
  CANCELLER_NAMES,
  CancellationTerms,
} from "#entities/booking";
import { dayOf, formatMoment, formatMoney, nightsBreakdown } from "#shared/lib";
import { DateRange, NightCount } from "#shared/ui";
import { useBookingLive, type BankAnswer } from "../model/use-booking-live";
import { earlyEndTerms, endedEarlyNote } from "../model/early-end-note";
import { BookingAdjustments } from "./booking-adjustments";
import { CancelStayButton } from "./cancel-stay-button";
import { EndStayEarlyButton } from "./end-stay-early-button";
import { PaymentForm } from "./payment-form";
import { RefundStayButton } from "./refund-stay-button";

export type { BankAnswer } from "../model/use-booking-live";

/**
 * One stay, kept current in the browser: the server render hands over the booking, and the
 * query cache holds it from then on, because the webhook confirming it and this page
 * cancelling it both change it without a navigation.
 *
 * **The webhook is the source of truth.** When the browser's payment succeeds — or the bank
 * sends the visitor back with `redirect_status` — the page polls `GET /bookings/:id` until
 * the status moves, bounded by the hold: unpaid, it lapses, and `EXPIRED` is a change too.
 * A lapsed hold takes the payment form away at its deadline rather than at the sweep's
 * minute later, when a payment would be charged and then refunded.
 *
 * The refunds admins sent are drawn under the card from here rather than by the page: a
 * press finished from that list waits for its webhook through the same hook as a refund
 * from the dialog.
 */
export const BookingLive = ({
  initial,
  viewer,
  publishableKey,
  bankAnswer,
  now,
  adjustments,
}: {
  initial: BookingDetail;
  viewer: User;
  /** The server's clock at the render, which the refund note and `mayCancel` start from. */
  now: string;
  /** Handed over only to the guest of a hold still waiting for payment. */
  publishableKey: string | null;
  /** The bank sent the visitor back here after a payment step of its own, or `null`. */
  bankAnswer: BankAnswer | null;
  /**
   * The refunds admins sent, newest first — empty for anybody but an admin, `null` when the
   * API could not answer for them (`readBookingAdjustments`).
   */
  adjustments: BookingAdjustment[] | null;
}) => {
  const {
    booking,
    paid,
    declined,
    markPaid,
    readAgain,
    awaitRefund,
    lapsed,
    clock,
    schedule,
  } = useBookingLive({ initial, now, bankAnswer });
  // Whether the early-end dialog is open: it stays on the page until it closes, even once
  // the stay can no longer end early — the day turned under it onto its last night.
  const [endingEarly, setEndingEarly] = useState(false);
  const pending = booking.status === BookingStatus.PENDING_PAYMENT;
  const confirmed = booking.status === BookingStatus.CONFIRMED;
  const { expiresAt } = booking;
  const refundNote = cancellationRefundNote(booking, viewer, clock);
  const canceller = cancellerOf(booking, viewer);
  // The guest's refund reads as part of the stay's state; what cancelling would cost the
  // host is a line of its own, so it is not read as a fee already charged.
  const hostNote = canceller === Canceller.HOST ? refundNote : null;
  const guestNote = canceller === Canceller.HOST ? null : refundNote;
  /*
    A lapsed hold waits only for the sweep to let its nights go, and a paid one for the
    webhook: neither is offered the button here. For a paid one that is this tab's
    courtesy, not a rule about the booking — `paid` is state of the tab, so the list or a
    reload still offers it, and the API copes by refunding the payment in full when the
    webhook lands. What the hidden button spares is "Cancelled" followed by "Payment
    refunded". The clock moves on for a confirmed stay only, so the deadline of a hold
    is `lapsed`.
  */
  const cancellable =
    canceller !== null &&
    mayCancel(booking, viewer, clock) &&
    !(pending && (lapsed || paid));
  // An admin's partial refund: nothing while the bank holds the payment in a dispute, which
  // Stripe refuses to refund — the API answers it with a `409` either way. The day is the
  // server's clock's, as `mayCancel`'s is: a stay not begun keeps its last cent.
  const today = dayOf(clock);
  const refundable =
    viewer.role === Role.ADMIN && booking.dispute !== DisputeStatus.OPEN
      ? refundableCents(booking, today)
      : NO_CENTS;
  // Ending a stay early is the guest's, or an admin's on their behalf — not the host's. A
  // stay with no nights recorded has nothing to measure a refund by, and the API refuses it,
  // as it refuses an open dispute.
  const endable =
    (canceller === Canceller.GUEST || canceller === Canceller.ADMIN) &&
    booking.nights.length > 0 &&
    booking.dispute !== DisputeStatus.OPEN &&
    mayEndEarly(booking, today);
  const endTerms = endable ? earlyEndTerms(booking, today) : null;
  const endedEarly = endedEarlyNote(booking);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <DateRange from={booking.from} to={booking.to} />
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <NightCount from={booking.from} to={booking.to} />
            <span className="font-medium text-foreground">
              {formatMoney(booking.amountCents, booking.currency)}
            </span>
          </CardDescription>
          <CardAction>
            <BookingStatusBadge status={booking.status} />
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {/* What each night was charged at when the hold was taken — a stay taken before the
            nights were recorded has none, and shows its total alone. */}
          {booking.nights.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {nightsBreakdown(booking.nights, booking.currency)}
              {/* The non-refundable rate's discount, taken off the nights once. */}
              {booking.discountCents > 0 &&
                ` − ${formatMoney(booking.discountCents, booking.currency)} non-refundable discount`}
            </p>
          )}

          {pending && paid && (
            <p
              role="status"
              className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
            >
              <Loader2Icon className="size-4 animate-spin" />
              Payment sent. Waiting for Stripe to confirm it — this page updates
              on its own.
            </p>
          )}

          {pending && !paid && !lapsed && expiresAt !== null && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              The nights are held until {formatMoment(expiresAt)} UTC. Unpaid by
              then, they go back on offer.
            </p>
          )}

          {pending && !paid && lapsed && expiresAt !== null && (
            <p
              role="status"
              className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
            >
              The hold lapsed at {formatMoment(expiresAt)} UTC and the nights
              went back on offer.
            </p>
          )}

          {pending && !paid && !lapsed && publishableKey !== null && (
            <PaymentForm
              bookingId={booking.id}
              publishableKey={publishableKey}
              declined={declined}
              onPaid={markPaid}
              onRefused={readAgain}
            />
          )}

          {confirmed && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              Paid and confirmed.{guestNote === null ? null : ` ${guestNote}`}
            </p>
          )}
          {confirmed && hostNote !== null && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              {hostNote}
            </p>
          )}

          {/* The whole schedule of a stay still holding its nights, dated: the policy was
            frozen onto it when it was booked, so the listing's policy today may differ. A
            hold is shown it too — it is what paying commits to — but nothing has been
            charged yet, and without saying so "No refund" reads as cancelling the hold
            costing money. */}
          {(pending || confirmed) && (
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">Cancellation</h3>
              {pending && (
                <p className="text-sm text-muted-foreground">
                  Nothing has been charged yet, so cancelling the hold costs
                  nothing. Once the stay is paid, a cancellation refunds as
                  follows.
                </p>
              )}
              <CancellationTerms
                policy={booking.cancellationPolicy}
                schedule={schedule}
              />
            </div>
          )}

          {/* Who took the stay away and why — the guest of a host's cancellation is owed it. */}
          {booking.cancelledBy !== null && booking.cancelledAt !== null && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm break-words text-muted-foreground">
              Cancelled by {CANCELLER_NAMES[booking.cancelledBy]} on{" "}
              {formatMoment(booking.cancelledAt)} UTC
              {booking.cancellationReason === null
                ? "."
                : `: “${booking.cancellationReason}”`}
            </p>
          )}

          {endedEarly !== null && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              {endedEarly}
            </p>
          )}

          {booking.refundedAmountCents !== null && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              {formatMoney(booking.refundedAmountCents, booking.currency)} was
              refunded to the card it was paid with.
            </p>
          )}

          {booking.refundOwedCents !== null && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              A refund of{" "}
              {formatMoney(booking.refundOwedCents, booking.currency)} is on its
              way to the card it was paid with.
            </p>
          )}
        </CardContent>

        {(cancellable || endable || endingEarly || refundable > 0) && (
          <CardFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            {cancellable && canceller !== null && (
              <CancelStayButton
                booking={booking}
                canceller={canceller}
                refundNote={refundNote}
              />
            )}
            {(endable || endingEarly) && (
              <EndStayEarlyButton
                bookingId={booking.id}
                terms={endTerms}
                onOpenChange={setEndingEarly}
                onRefused={readAgain}
                onEnded={readAgain}
              />
            )}
            {refundable > 0 && (
              <RefundStayButton
                bookingId={booking.id}
                refundableCents={refundable}
                currency={booking.currency}
                keepsLastCent={isCancellableOn(booking, today)}
                onRefunded={awaitRefund}
              />
            )}
          </CardFooter>
        )}
      </Card>

      <BookingAdjustments
        bookingId={booking.id}
        adjustments={adjustments}
        onRefunded={awaitRefund}
      />
    </>
  );
};
