"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
// The `pure` entry injects the script when `loadStripe` is first called rather than when
// the module is imported, so a host, an admin or a paid stay never load Stripe.js at all.
import { loadStripe } from "@stripe/stripe-js/pure";
import type { PaymentIntent, Stripe } from "@stripe/stripe-js";
import type { Cents, Currency } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError } from "@repo/ui/components/field";
import { Skeleton } from "@repo/ui/components/skeleton";
import { ApiResponseError, bookingsApi } from "#shared/api";
import { HTTP_STATUS, stripeVariables } from "#shared/config";
import { formatMoney, toFormErrors } from "#shared/lib";
import { bookingPaymentKey } from "../api/booking-query";

/**
 * Stripe.js for one key, held by the query cache for the life of the tab: `Elements`
 * refuses a `stripe` prop that changes after it was set, so the instance has to outlive the
 * poll's re-renders. A query rather than a bare promise so that a script that never loaded
 * — a blocker, a network gone — is an error with a way to ask again; `loadStripe` injects
 * the script anew after a failure.
 */
const stripeJsKey = (publishableKey: string) =>
  ["stripe-js", publishableKey] as const;

async function loadStripeOrFail(publishableKey: string): Promise<Stripe> {
  const stripe = await loadStripe(publishableKey);

  // `null` is a render without `window`, which a query in a client component never is.
  if (stripe === null) throw new Error("Stripe.js is unavailable here");

  return stripe;
}

/** A conflict from the API: the hold moved on, or another request is opening its payment. */
const isConflict = (error: unknown): boolean =>
  error instanceof ApiResponseError && error.status === HTTP_STATUS.CONFLICT;

/**
 * How long a conflict waits before the payment is asked for again, and how many times. Stripe
 * refuses a second request under the same idempotency key only while the first is in flight,
 * which is a second or two — a hold that moved on has taken the form off the page by then.
 */
const CONFLICT_RETRY_DELAY_MS = 1_000;
const CONFLICT_RETRIES = 4;

/**
 * What an intent is in once the guest's part is done; the webhook says the rest.
 * `processing` belongs here only while every method the API offers is an instant one — see
 * `bankAnswerOf` in `booking-page.tsx`.
 */
const PAID: ReadonlySet<PaymentIntent.Status> = new Set([
  "succeeded",
  "processing",
  "requires_capture",
]);

/**
 * The payment of one hold, through Stripe Elements: the card details go from the browser to
 * Stripe and never through this site. The PaymentIntent's secret is asked for here, from the
 * browser, once the form is on the screen — `POST /bookings/:id/payment` opens it the first
 * time and answers the same one after that, so a reload or a second tab pays the same intent.
 *
 * Opened once per hold, whatever asks: the query cache reuses a request in flight, so React's
 * Strict Mode mounting the form twice and a remount land on the one `POST`, and the secret
 * it answered is kept for the life of the tab. "Try again" cannot be pressed twice either:
 * the first press puts the query back to pending, and the skeleton takes the button away.
 *
 * Success here is the browser's word, and the page does not take it: `onPaid` only starts
 * the poll that waits for the webhook. A `409` is either a hold that stopped waiting for
 * payment — paid, cancelled or lapsed — or another tab opening the same payment at the same
 * moment, and only the booking tells the two apart. So every `409` has the page read it
 * again (`onRefused`) and is asked again after a pause, the skeleton still drawn: a hold
 * that moved on takes this form off the page, which stops the retries, and one still
 * waiting gets its secret from the request that won. Past the last retry the form shows
 * the API's reason and the way to ask again.
 */
export const PaymentForm = ({
  bookingId,
  publishableKey,
  declined,
  onPaid,
  onRefused,
}: {
  bookingId: string;
  publishableKey: string;
  /** The bank sent the visitor back after refusing a payment step of its own. */
  declined: boolean;
  onPaid: () => void;
  onRefused: () => void;
}) => {
  const { resolvedTheme } = useTheme();
  const payment = useQuery({
    queryKey: bookingPaymentKey(bookingId),
    queryFn: () => bookingsApi.payment(bookingId),
    // One intent per hold, which does not change: nothing to refetch on focus or remount,
    // and nothing to forget either — a form remounted later reuses the secret, not a `POST`.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: (failures, error) =>
      isConflict(error) && failures < CONFLICT_RETRIES,
    retryDelay: CONFLICT_RETRY_DELAY_MS,
    refetchOnWindowFocus: false,
  });
  const stripeJs = useQuery({
    queryKey: stripeJsKey(publishableKey),
    queryFn: () => loadStripeOrFail(publishableKey),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  // Per attempt rather than once: each conflict, retried or final, reads the booking again.
  // The count starts over with every fetch, so a "Try again" refused again reads it too.
  const refusals = isConflict(payment.failureReason) ? payment.failureCount : 0;

  useEffect(() => {
    if (refusals > 0) onRefused();
  }, [refusals, onRefused]);

  if (payment.isError) {
    return (
      <RetryNotice
        // Whatever the API answered, worded by it; a drift from the contract propagates.
        message={
          toFormErrors(payment.error).message ??
          "The payment could not be opened."
        }
        retrying={payment.isFetching}
        onRetry={() => {
          void payment.refetch();
        }}
      />
    );
  }

  if (stripeJs.isError) {
    return (
      <RetryNotice
        message="The payment form could not load. If something in this browser blocks js.stripe.com, allow it and try again."
        retrying={stripeJs.isFetching}
        onRetry={() => {
          void stripeJs.refetch();
        }}
      />
    );
  }

  if (payment.data === undefined || stripeJs.data === undefined) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  return (
    <Elements
      stripe={stripeJs.data}
      options={{
        clientSecret: payment.data.clientSecret,
        // The iframe cannot read this site's tokens: the nearest of Stripe's themes, with
        // the tokens copied over it. A theme switched later is passed on in place; the
        // secret is what Elements refuses a change of, hence the intent's query never
        // refetching.
        appearance: {
          theme: resolvedTheme === "dark" ? "night" : "stripe",
          variables: stripeVariables(resolvedTheme),
        },
      }}
    >
      <PaymentFields
        clientSecret={payment.data.clientSecret}
        amountCents={payment.data.amountCents}
        currency={payment.data.currency}
        declined={declined}
        onPaid={onPaid}
      />
    </Elements>
  );
};

/** A refusal before the boxes could be drawn, and the way to ask again. */
const RetryNotice = ({
  message,
  retrying,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) => (
  <div className="flex flex-col gap-3">
    <FieldError>{message}</FieldError>
    <Button
      variant="outline"
      className="w-full sm:w-auto sm:self-start"
      loading={retrying}
      onClick={onRetry}
    >
      Try again
    </Button>
  </div>
);

/**
 * The boxes, drawn only once Stripe has said the intent is still to be paid. The API answers
 * the same secret for as long as the hold is pending, so a reload between a payment
 * confirmed in place and its webhook would otherwise draw a form for an intent already paid
 * — one whose "Pay" Stripe refuses — and never start the poll. Such an intent starts it.
 */
const PaymentFields = ({
  clientSecret,
  amountCents,
  currency,
  declined,
  onPaid,
}: {
  clientSecret: string;
  amountCents: Cents;
  currency: Currency;
  declined: boolean;
  onPaid: () => void;
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const [unpaid, setUnpaid] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(
    declined
      ? "Your bank did not approve the payment. Try again, or pay with another card."
      : null,
  );

  useEffect(() => {
    if (stripe === null) return;

    let current = true;

    stripe.retrievePaymentIntent(clientSecret).then(
      ({ paymentIntent }) => {
        if (!current) return;

        if (paymentIntent !== undefined && PAID.has(paymentIntent.status)) {
          onPaid();
        } else {
          setUnpaid(true);
        }
      },
      // A look that failed leaves the form to try: Stripe refuses a paid intent itself.
      () => {
        if (current) setUnpaid(true);
      },
    );

    return () => {
      current = false;
    };
  }, [stripe, clientSecret, onPaid]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (stripe === null || elements === null) return;

    setPending(true);
    setMessage(null);

    const result = await stripe
      .confirmPayment({
        elements,
        // A card that needs no further step is confirmed in place; one that does goes to
        // its bank and comes back here. Without the query, or the `redirect_status` of an
        // earlier attempt would be repeated beside the new one.
        redirect: "if_required",
        confirmParams: {
          return_url: `${window.location.origin}${window.location.pathname}`,
        },
      })
      // Stripe.js rejects only for a network gone mid-call or a mistake of the integration;
      // either way the hold is still the guest's to try again.
      .catch(() => null);

    setPending(false);

    if (result !== null && result.error === undefined) {
      onPaid();

      return;
    }

    // A decline, a card typed wrong: Stripe words it for the visitor, and the hold is still
    // theirs to pay with another card until it lapses.
    setMessage(result?.error.message ?? "The payment did not go through.");
  };

  if (!unpaid) return <Skeleton className="h-64 w-full rounded-lg" />;

  return (
    // `noValidate` for the reason every form here has it; the boxes are Stripe's anyway.
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <PaymentElement />

      {message !== null && <FieldError>{message}</FieldError>}

      <Button
        type="submit"
        size="lg"
        loading={pending}
        disabled={stripe === null || elements === null || pending}
        className="w-full sm:w-auto sm:self-start"
      >
        Pay {formatMoney(amountCents, currency)}
      </Button>
    </form>
  );
};
