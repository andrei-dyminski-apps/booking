import { refusedWith } from "#shared/api";

/**
 * The refusals after which a listed claim may be gone, or the stay may no longer cover what
 * it was for: Stripe refused the refund, the bank disputed the payment, less is left than
 * the press asked. A refusal that changed nothing — another request holds the stay, a claim
 * too young to let go, a press under another amount — is the dialog's to show, and the list
 * under the stay is as it was.
 */
export const mayHaveReleasedClaim = (error: unknown): boolean =>
  refusedWith(
    error,
    "REFUND_EXCEEDS_PAYMENT",
    "REFUND_EXCEEDS_REMAINING",
    "REFUND_REFUSED_BY_PROVIDER",
    "NOTHING_LEFT_TO_REFUND",
    "PAYMENT_DISPUTED",
    "STAY_NOT_PAID",
  );
