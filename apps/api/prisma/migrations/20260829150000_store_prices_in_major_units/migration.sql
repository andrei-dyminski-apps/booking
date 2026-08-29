-- Prices stop being minor units and become the currency itself: 12000 was 120.00 a night,
-- and from here that column holds 120.00. The `USING` clause is the migration of the data
-- rather than just of the type -- without it every existing listing would come back a
-- hundred times its price.
--
-- `numeric(10, 2)` rather than a float: a float stores neither 120.10 nor the sum of a
-- stay's nights exactly, and the error accumulates across the nights. The scale is the
-- cent, which is what `listingSchema` in `@repo/contracts` refuses to go finer than, so
-- the column can never round a price the API accepted.
--
-- The two partial indexes over this table are rebuilt by Postgres as part of the ALTER,
-- and both stay correct: `listings_offered_price_id_idx` orders by this column, and a
-- numeric btree orders exactly as the integer one did.
ALTER TABLE "listings"
  ALTER COLUMN "price_per_night" TYPE DECIMAL(10, 2)
  USING ("price_per_night"::decimal / 100);
