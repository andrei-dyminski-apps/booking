/**
 * A save that would leave a listing under the `NON_REFUNDABLE` policy and offering a
 * non-refundable rate at once — `listings_rate_beside_refundable_policy`, translated. Only
 * a `PATCH` naming one half reaches it: a body naming both is the contract's to refuse.
 */
export class RateUnderNonRefundablePolicyError extends Error {
  constructor(listingId: string) {
    super(
      `Listing ${listingId} would offer a non-refundable rate under a non-refundable policy`,
    );
    this.name = "RateUnderNonRefundablePolicyError";
  }
}
