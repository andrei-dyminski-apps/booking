import type { PayoutCountry } from "@repo/contracts";
import { ApiResponseError, ApiUnreachableError, payoutsApi } from "#shared/api";

/**
 * Where the host's payout account can be opened — Stripe's answer, through the API.
 *
 * `null` when the API refuses or cannot be reached, instead of an error, for the reason
 * `readBookingAdjustments` gives: the page still draws its fees and says the form is not
 * available, rather than going down with the one read Stripe stands behind. Anything else
 * is a broken response rather than an unavailable one, and still throws.
 */
export async function readPayoutCountries(): Promise<PayoutCountry[] | null> {
  try {
    return (await payoutsApi.countries()).countries;
  } catch (error) {
    if (
      error instanceof ApiResponseError ||
      error instanceof ApiUnreachableError
    ) {
      return null;
    }

    throw error;
  }
}
