-- Every stay booked so far was booked at the standard rate. The default only backfills them
-- and is dropped at once, so `create` has to write the discount, as it writes the policy.
ALTER TABLE "bookings" ADD COLUMN "discount_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bookings" ALTER COLUMN "discount_cents" DROP DEFAULT;

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "non_refundable_discount_bps" INTEGER;

-- The bounds Prisma cannot express, for the writes that go around the API: a discount of at
-- most half the nights, and a listing's rate within `MAX_NON_REFUNDABLE_DISCOUNT_BPS` and the
-- floor beside it in `@repo/contracts`. Raising either bound means raising both, in one change.
-- Half the nights rounded half up is `2 * discount <= amount + discount + 1`, which is the
-- `+ 1` below: at 50% an odd total gives the guest the odd cent, one more than is left.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_discount_within_amount"
  CHECK ("discount_cents" >= 0 AND "discount_cents" <= "amount_cents" + 1);

ALTER TABLE "listings"
  ADD CONSTRAINT "listings_discount_within_contract"
  CHECK ("non_refundable_discount_bps" IS NULL OR "non_refundable_discount_bps" BETWEEN 100 AND 5000);

-- A listing under the `NON_REFUNDABLE` policy offers no non-refundable rate: its standard
-- rate already refunds nothing, so the discount would buy nothing. `createListingSchema`
-- refuses a body naming both; this is what refuses a `PATCH` naming one of them that meets
-- the other on the row, and `ListingRepository.update` answers it as a `400`.
ALTER TABLE "listings"
  ADD CONSTRAINT "listings_rate_beside_refundable_policy"
  CHECK ("cancellation_policy" <> 'NON_REFUNDABLE' OR "non_refundable_discount_bps" IS NULL);
