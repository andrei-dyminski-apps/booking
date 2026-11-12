"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { differenceInMilliseconds, isBefore, parseISO } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookingStatus,
  checkInDayEnd,
  checkInInstant,
  refundSchedule,
  stayDay,
  type BookingDetail,
  type Cents,
  type RefundWindow,
} from "@repo/contracts";
import { bookingKey, readBooking } from "../api/booking-query";

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

/**
 * How long the page waits for an admin's refund to be reported. Unlike the other waits this
 * one can be waiting for nothing: a press finished from the list may name a refund whose
 * webhook landed long ago and raised the total this tab read already, so no change is
 * coming. Stripe reports a refund within seconds, and the API measures the next refund
 * against Stripe's own total anyway, so the wait ends with the fast phase of `pollDelay`.
 */
const REFUND_REPORT_WAIT_MS = 60_000;

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
 * The stay's page as one machine: the booking in the query cache and the poll that keeps it
 * current, the tab's `paid`/`declined` from the bank's answer, the hold's deadline and the
 * clock the refund note moves on, and the wait for an admin's refund to be reported.
 * `BookingLive` draws what this returns.
 */
export function useBookingLive({
  initial,
  now,
  bankAnswer,
}: {
  initial: BookingDetail;
  /** The server's clock at the render, which `clock` starts from. */
  now: string;
  /** The bank sent the visitor back here after a payment step of its own, or `null`. */
  bankAnswer: BankAnswer | null;
}): {
  booking: BookingDetail;
  paid: boolean;
  declined: boolean;
  markPaid: () => void;
  readAgain: () => void;
  awaitRefund: () => void;
  lapsed: boolean;
  clock: string;
  schedule: RefundWindow[];
} {
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
  // The refund total an admin's refund went out against, until the webhook raises it: what is
  // left to refund is measured against that total, and the dialog would offer a ceiling the
  // refund has already lowered. `since` bounds the wait (`REFUND_REPORT_WAIT_MS`). `null`
  // while no refund from this tab is waited for.
  const [refundSentOver, setRefundSentOver] = useState<{
    total: Cents | null;
    since: number;
  } | null>(null);
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
    // Three things land after the request that set them off: the webhook confirming a paid
    // hold, the job sending the refund a cancellation owes, and the webhook reporting an
    // admin's refund (`charge.refunded`, which raises the refund total — whatever it raises
    // it to ends the wait, since that is what the ceiling is measured against). Each is
    // waited for while it is on its way, and no longer.
    refetchInterval: (query) => {
      const data = query.state.data;
      const waiting =
        ((paid || lapsed) && data?.status === BookingStatus.PENDING_PAYMENT) ||
        (data?.refundOwedCents ?? null) !== null ||
        (refundSentOver !== null &&
          data?.refundedAmountCents === refundSentOver.total &&
          Date.now() - refundSentOver.since < REFUND_REPORT_WAIT_MS);

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

  // An admin's refund went out — from the dialog, or a press finished from the list: read the
  // stay at once — the webhook may have landed already — and go on reading it until the
  // refund total moves off the one the refund was sent over, for a minute at most.
  const awaitRefund = useCallback(() => {
    setRefundSentOver({
      total: booking.refundedAmountCents,
      since: Date.now(),
    });
    readAgain();
  }, [booking.refundedAmountCents, readAgain]);

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
  const { from, to, createdAt, cancellationPolicy, timeZone, checkInTime } =
    booking;
  // Read by the timer below and drawn under "Cancellation": one schedule for both, kept
  // across the poll's re-renders, which change none of the facts it is made of.
  const schedule = useMemo(
    () =>
      refundSchedule({
        from,
        timeZone,
        checkInTime,
        createdAt,
        cancellationPolicy,
      }),
    [from, timeZone, checkInTime, createdAt, cancellationPolicy],
  );

  // Every moment the refund falls, then check-in, when "Cancel" goes and "End stay early"
  // comes, and every midnight of the stay after it on the listing's clock, when what ending
  // it early refunds drops by a night: the note is redrawn at each of them, earliest first.
  useEffect(() => {
    if (!confirmed) return;

    const now = parseISO(clock);
    const day = stayDay({ timeZone }, now);
    // Where the listing's night turns: the first moment of its tomorrow, which on a night a
    // clock skips midnight is whatever moment the day begins with.
    const midnights =
      from <= day && day < to ? [checkInDayEnd({ timeZone }, day)] : [];
    const next = [
      ...schedule.map(({ until }) => until),
      checkInInstant({ from, timeZone, checkInTime }),
      ...midnights,
    ].find((moment) => isBefore(now, moment));

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
  }, [confirmed, schedule, from, to, timeZone, checkInTime, clock]);

  return {
    booking,
    paid,
    declined,
    markPaid,
    readAgain,
    awaitRefund,
    lapsed,
    clock,
    schedule,
  };
}
