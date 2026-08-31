-- The ceiling on a nightly price stops being a rule of the contract alone. `MAX_PRICE` in
-- `@repo/contracts` is 1 000 000, and this constraint says the same number here, so the two
-- ends cannot drift.
--
-- The column is left as `numeric(10, 2)` and needs no change: the scale is still the cent --
-- what the contract refuses to go finer than -- and the precision already holds a hundred
-- times the ceiling. That is deliberate headroom rather than an oversight: the number a
-- price is refused against is a rule, and a rule belongs in a constraint that can be read
-- and moved, not in the width of a type where raising it rewrites the table.
--
-- The constraint is a backstop rather than a second gate. Nothing that arrives over HTTP
-- can reach it: `createListingSchema` and `updateListingSchema` refuse a price above the
-- ceiling with a 400 long before a statement is built, which is why no repository
-- translates SQLSTATE 23514 into an exception of its own. What it guards is every write
-- that never passes through those schemas -- the seed, a later migration, a bulk import,
-- psql -- because a row above the ceiling is not refused when it is written but when it is
-- read: the frontend parses every response against `listingSchema`, so one such row would
-- take out the whole catalogue page rather than itself.
--
-- Zero and below are refused for the same reason and in the same place. `listingSchema`
-- has always said `positive()`, and the column never did.
ALTER TABLE "listings"
  ADD CONSTRAINT "listings_price_within_contract"
  CHECK ("price_per_night" > 0 AND "price_per_night" <= 1000000);
