-- A failed refund records the currency it was refunded in, as a stay records the one it was
-- charged in, so the row says on its own what its `amount_cents` are cents of. Every refund
-- so far was of a charge in the site's one currency, which is what the default writes into
-- them; it is dropped right after, so a new row has to say its currency.
ALTER TABLE "refund_failures" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'usd';
ALTER TABLE "refund_failures" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "refund_failures"
  ADD CONSTRAINT "refund_failures_currency_supported" CHECK ("currency" IN ('usd'));
