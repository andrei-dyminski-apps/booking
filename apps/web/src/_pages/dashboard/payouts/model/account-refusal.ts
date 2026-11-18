import { refusedWith } from "#shared/api";

/** Another request is opening this very account: the one answer worth asking again for. */
export const isBeingOpened = (error: unknown): boolean =>
  refusedWith(error, "PAYOUT_ACCOUNT_BEING_OPENED");

/**
 * Stripe's list no longer has the country the form offered. Read off the code rather than
 * the `400`, which a malformed body answers too.
 */
export const isCountryUnsupported = (error: unknown): boolean =>
  refusedWith(error, "PAYOUT_COUNTRY_UNSUPPORTED");
