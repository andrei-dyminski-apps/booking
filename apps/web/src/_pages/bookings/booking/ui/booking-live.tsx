"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { differenceInMilliseconds, isBefore, parseISO } from "date-fns";
import { Loader2Icon } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookingStatus,
  refundSchedule,
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
import { BookingStatusBadge, CancellationTerms } from "#entities/booking";
import {
  dayStart,
  formatMoment,
  formatMoney,
  nightsBreakdown,
} from "#shared/lib";
import { DateRange, NightCount } from "#shared/ui";
import { bookingKey, readBooking } from "../api/booking-query";
import { CancelStayButton } from "./cancel-stay-button";
import { PaymentForm } from "./payment-form";

/**
 * How often the page asks whether the webhook has landed. Stripe usually delivers within a
 * second or two of the payment; asking faster would only spend requests on the same answer.
 */
const CONFIRMATION_POLL_MS = 2_000;

/**
 * How long to wait before asking again, by how long the page has waited so far. A webhook or
 * a refund still missing after a minute is late for a reason a person has to look at — a
 * failed delivery, a stuck job — so the page asks less and less often rather than spending a
 * request every two seconds for as long as the tab stays open.
 */
function pollDelay(waitedMs: number): number {
  if (waitedMs < 60_000) return CONFIRMATION_POLL_MS;
  if (waitedMs < 300_000) return 10_000;

  return 60_000;
}

/** The longest delay `setTimeout` keeps; a longer one fires at once. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** The query Stripe sends the visitor back with after a step at their bank. */
const STRIPE_RETURN_PARAMS = [
  "payment_intent",
  "payment_intent_client_secret",
  "redirect_status",
] as const;

/** What the bank said when it sent the visitor back here, read off `redirect_status`. */
export type BankAnswer = "paid" | "declined";

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
 */
export const BookingLive = ({
  initial,
  viewer,
  publishableKey,
  bankAnswer,
  now,
}: {
  initial: BookingDetail;
  viewer: User;
  /** The server's clock at the render, which the refund note and `mayCancel` start from. */
  now: string;
  /** Handed over only to the guest of a hold still waiting for payment. */
  publishableKey: string | null;
  /** The bank sent the visitor back here after a payment step of its own, or `null`. */
  bankAnswer: BankAnswer | null;
}) => {
  const queryClient = useQueryClient();
  const [paid, setPaid] = useState(bankAnswer === "paid");
  // Held rather than read off the prop: the URL it came from is cleaned up below.
  const [declined] = useState(bankAnswer === "declined");
  const markPaid = useCallback(() => {
    setPaid(true);
  }, []);
  // The refund note and the offer to cancel are decided by the server's clock first, so the
  // render and the hydration agree; it moves on at the moments they change under a page left
  // open — the free window closing, and the check-in day.
  const [clock, setClock] = useState(now);
  // When the current wait for the webhook or a refund began, for `pollDelay`.
  const waitingSince = useRef<number | null>(null);
  // The payment was refused because the hold moved on; what it became is the next read.
  const readAgain = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: bookingKey(initial.id) });
  }, [queryClient, initial.id]);
  // Decided by the server's clock first, so the render and the hydration agree.
  const [lapsed, setLapsed] = useState(
    () =>
      initial.expiresAt !== null &&
      !isBefore(parseISO(now), parseISO(initial.expiresAt)),
  );
  const { data: booking } = useQuery({
    queryKey: bookingKey(initial.id),
    queryFn: () => readBooking(initial.id),
    initialData: initial,
    // The server render read it a moment ago; without this the mount reads it again.
    staleTime: CONFIRMATION_POLL_MS,
    // `initialData` only seeds an empty cache: a row kept from an earlier visit would be
    // drawn instead of the render's fresher one. Nothing outside this page reads the key.
    gcTime: 0,
    // Two things land after the request that set them off: the webhook confirming a paid
    // hold, and the job sending the refund a cancellation owes. Each is waited for while
    // it is on its way, and no longer.
    refetchInterval: (query) => {
      const data = query.state.data;
      const waiting =
        ((paid || lapsed) && data?.status === BookingStatus.PENDING_PAYMENT) ||
        (data?.refundOwedCents ?? null) !== null;

      if (!waiting) {
        waitingSince.current = null;

        return false;
      }

      const now = Date.now();

      waitingSince.current ??= now;

      return pollDelay(now - waitingSince.current);
    },
  });

  // What Stripe appends on the way back from a bank is read once and taken out of the
  // address: a reload would otherwise repeat a bank's answer the page has moved on from, and
  // the intent's secret would stay in the history and the `Referer`. Taken out whatever the
  // status says — one `bankAnswerOf` does not know leaves the secret there just the same.
  // The router's own history entry is kept, so this is no navigation.
  useEffect(() => {
    const url = new URL(window.location.href);
    const returned = STRIPE_RETURN_PARAMS.filter((name) =>
      url.searchParams.has(name),
    );

    if (returned.length === 0) return;

    for (const name of returned) url.searchParams.delete(name);

    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);

  const pending = booking.status === BookingStatus.PENDING_PAYMENT;
  const { expiresAt } = booking;

  // The deadline is reached by the browser's clock, which is not the server's that decided
  // `lapsed` above: a clock set wrong takes the form away early or leaves it late. Neither
  // decides anything — the sweep lets the nights go by the API's clock, and a payment for
  // nights no longer the guest's is refunded by the API (`booking-payment.handler.ts`).
  useEffect(() => {
    if (!pending || lapsed || expiresAt === null) return;

    const timer = setTimeout(
      () => {
        setLapsed(true);
      },
      differenceInMilliseconds(parseISO(expiresAt), new Date()),
    );

    return () => {
      clearTimeout(timer);
    };
  }, [pending, lapsed, expiresAt]);

  const confirmed = booking.status === BookingStatus.CONFIRMED;
  const { from, createdAt, cancellationPolicy } = booking;
  // Read by the timer below and drawn under "Cancellation": one schedule for both, kept
  // across the poll's re-renders, which change none of the three facts it is made of.
  const schedule = useMemo(
    () => refundSchedule({ from, createdAt, cancellationPolicy }),
    [from, createdAt, cancellationPolicy],
  );

  // Every moment the refund falls, then check-in, when the button goes: the note is
  // redrawn at each of them, earliest first.
  useEffect(() => {
    if (!confirmed) return;

    const next = [...schedule.map(({ until }) => until), dayStart(from)].find(
      (moment) => isBefore(parseISO(clock), moment),
    );

    if (next === undefined) return;

    const delay = differenceInMilliseconds(next, new Date());

    if (delay > MAX_TIMEOUT_MS) return;

    const timer = setTimeout(
      () => {
        setClock(new Date().toISOString());
      },
      Math.max(delay, 0),
    );

    return () => {
      clearTimeout(timer);
    };
  }, [confirmed, schedule, from, clock]);

  const refundNote = cancellationRefundNote(booking, viewer, clock);

  return (
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
            The hold lapsed at {formatMoment(expiresAt)} UTC and the nights went
            back on offer.
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
            Paid and confirmed.{refundNote === null ? null : ` ${refundNote}`}
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

        {booking.refundedAmountCents !== null && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            {formatMoney(booking.refundedAmountCents, booking.currency)} was
            refunded to the card it was paid with.
          </p>
        )}

        {booking.refundOwedCents !== null && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            A refund of {formatMoney(booking.refundOwedCents, booking.currency)}{" "}
            is on its way to the card it was paid with.
          </p>
        )}
      </CardContent>

      {/*
        A lapsed hold waits only for the sweep to let its nights go, and a paid one for the
        webhook: neither is offered the button here. For a paid one that is this tab's
        courtesy, not a rule about the booking — `paid` is state of the tab, so the list or a
        reload still offers it, and the API copes by refunding the payment in full when the
        webhook lands. What the hidden button spares is "Cancelled" followed by "Payment
        refunded". The clock moves on for a confirmed stay only, so the deadline of a hold
        is `lapsed`.
      */}
      {mayCancel(booking, viewer, clock) && !(pending && (lapsed || paid)) && (
        <CardFooter>
          <CancelStayButton booking={booking} refundNote={refundNote} />
        </CardFooter>
      )}
    </Card>
  );
};
