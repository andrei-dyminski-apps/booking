"use server";

import { refresh } from "next/cache";
import {
  openPayoutAccountSchema,
  PAYOUT_COUNTRY_UNSUPPORTED_MESSAGE,
  type OpenPayoutAccountInput,
} from "@repo/contracts";
import { payoutsApi } from "#shared/api";
import {
  NO_FORM_ERRORS,
  toFieldErrors,
  toFormErrors,
  type FormErrors,
} from "#shared/lib";
import { isBeingOpened, isCountryUnsupported } from "../model/account-refusal";

/**
 * How long an account another request is opening (`PAYOUT_ACCOUNT_BEING_OPENED`) waits
 * before it is asked for again, and how many times: enough to outlast the eight seconds the
 * API gives Stripe to open one. Once the first request is answered, a retry is answered with
 * the account it opened.
 */
const BEING_OPENED_RETRY_DELAY_MS = 1_000;
const BEING_OPENED_RETRIES = 9;

/**
 * Opening the host's payout account in the country they picked. The page reads the status
 * on the server, so a success re-renders it with Stripe's onboarding form in place of this
 * one. The country is parsed again here, because the action is an endpoint of its own.
 */
export async function openAccountAction(
  _state: FormErrors,
  values: OpenPayoutAccountInput,
): Promise<FormErrors> {
  const parsed = openPayoutAccountSchema.safeParse(values);

  if (!parsed.success) {
    return { message: null, fields: toFieldErrors(parsed.error.issues) };
  }

  try {
    await openAccount(parsed.data);
  } catch (error) {
    // The list the page was drawn with is older than Stripe's: it is read again, and the
    // refusal sits under the box it is about, in the words the schema uses for it.
    if (isCountryUnsupported(error)) {
      refresh();

      return {
        message: null,
        fields: { country: [PAYOUT_COUNTRY_UNSUPPORTED_MESSAGE] },
      };
    }

    // A 502 for a Stripe that refused or could not be reached, a 409 still being opened
    // after the retries, an unreachable API.
    return toFormErrors(error);
  }

  refresh();

  return NO_FORM_ERRORS;
}

async function openAccount(input: OpenPayoutAccountInput): Promise<void> {
  for (let failures = 0; ; failures += 1) {
    try {
      await payoutsApi.open(input);

      return;
    } catch (error) {
      if (!isBeingOpened(error) || failures >= BEING_OPENED_RETRIES) {
        throw error;
      }
    }

    await new Promise((resolve) =>
      setTimeout(resolve, BEING_OPENED_RETRY_DELAY_MS),
    );
  }
}
