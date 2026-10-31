"use server";

import { refresh } from "next/cache";
import {
  resolveRefundFailureSchema,
  stuckKindSchema,
  type ResolveRefundFailureInput,
  type StuckKind,
} from "@repo/contracts";
import { bookingsApi, paymentEventsApi, refundFailuresApi } from "#shared/api";
import {
  NO_FORM_ERRORS,
  toFieldErrors,
  toFormErrors,
  type FormErrors,
} from "#shared/lib";

/**
 * Handing a set-aside event back to the worker. None of the three actions redirects: the
 * row leaves the list it was on, and `refresh()` is what re-renders the list without it —
 * every read of this screen is `no-store`, so the router's copy is all there is to drop.
 */
export async function retryPaymentEventAction(
  eventId: string,
): Promise<FormErrors> {
  return settle(() => paymentEventsApi.retry(eventId));
}

/**
 * Handing a stay's stuck refund or payout back to its job. The kind is bound by the card,
 * and parsed anyway: it becomes a segment of the path, and an action is an endpoint whose
 * arguments anybody could spell.
 */
export async function retryStuckAction(
  bookingId: string,
  kind: StuckKind,
): Promise<FormErrors> {
  const parsed = stuckKindSchema.safeParse(kind);

  if (!parsed.success)
    return { message: "Unknown kind of payment", fields: {} };

  return settle(() => bookingsApi.retryStuck(bookingId, parsed.data));
}

/**
 * Recording how a bounced refund went back to the guest. A box somebody types into, so it
 * is parsed again here with the schema the browser already ran.
 */
export async function resolveRefundFailureAction(
  refundId: string,
  _state: FormErrors,
  values: ResolveRefundFailureInput,
): Promise<FormErrors> {
  const parsed = resolveRefundFailureSchema.safeParse(values);

  if (!parsed.success) {
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  }

  return settle(() => refundFailuresApi.resolve(refundId, parsed.data));
}

async function settle(request: () => Promise<void>): Promise<FormErrors> {
  try {
    await request();
  } catch (error) {
    // A 409 for a row another admin handled first, a 404 for one that has gone, an
    // unreachable API: each belongs next to the button that provoked it.
    return toFormErrors(error);
  }

  refresh();

  return NO_FORM_ERRORS;
}
