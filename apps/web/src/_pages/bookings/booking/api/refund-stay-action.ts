"use server";

import { refresh } from "next/cache";
import { adminRefundSchema, type AdminRefundInput } from "@repo/contracts";
import { ApiResponseError, bookingsApi } from "#shared/api";
import { HTTP_STATUS } from "#shared/config";
import {
  NO_FORM_ERRORS,
  toFieldErrors,
  toFormErrors,
  type FormErrors,
} from "#shared/lib";
import type { RefundErrors } from "../model/refund-form";

/**
 * An admin giving back part of a stay without cancelling it — from the dialog, or by
 * finishing a press Stripe never answered from the list under the stay. The stay is bound by
 * the page rather than taken from the payload, as `createBookingAction`'s listing is: both
 * callers hand over the id the page rendered, and the body carries none. The amount, the
 * reason and the request id are parsed again here with the schema the API validates the
 * body with, because the action is an endpoint of its own.
 * Nothing cached changes — the nights stay taken — so only the page is drawn again: with the
 * refund under the stay, or, when nobody can say whether it went out, with the press listed
 * as unconfirmed, so it can be finished once the dialog is closed.
 */
export async function refundStayAction(
  bookingId: string,
  _state: FormErrors,
  values: AdminRefundInput,
): Promise<RefundErrors> {
  const parsed = adminRefundSchema.safeParse(values);

  if (!parsed.success) {
    return {
      message: null,
      fields: toFieldErrors(parsed.error.issues),
      uncertain: false,
    };
  }

  try {
    await bookingsApi.refund(bookingId, parsed.data);
  } catch (error) {
    // A 4xx is the API's answer about this press; a 502, or no answer at all, leaves it open
    // whether the refund went out — pressing again sends the same refund, not a second one.
    const uncertain = !(
      error instanceof ApiResponseError &&
      error.status < HTTP_STATUS.INTERNAL_SERVER_ERROR
    );

    // An unknown answer lists the press under the stay as unconfirmed; a 409 may have let a
    // listed claim go — Stripe refused it, or the stay no longer covers it — or found it
    // finished meanwhile, and the list has to say so rather than keep offering to finish it.
    if (
      uncertain ||
      (error instanceof ApiResponseError &&
        error.status === HTTP_STATUS.CONFLICT)
    ) {
      refresh();
    }

    return { ...toFormErrors(error), uncertain };
  }

  refresh();

  return { ...NO_FORM_ERRORS, uncertain: false };
}
