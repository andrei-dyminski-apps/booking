-- The second ordering the catalogue offers, and the second index it needs. `GET /listings`
-- now takes a `sort`, and the four values it accepts are two keys read in both directions:
-- "created_at" is already indexed by `index_offered_listings_for_the_catalogue`, this one
-- is the price.
--
-- Partial on the same predicate, for the same reason: a retired listing is not in the
-- catalogue at all, so it has no business taking up space in the index that serves it.
--
-- Both columns ASC, and one index for both directions of the price. The catalogue orders
-- by "price_per_night ASC, id ASC" or by "price_per_night DESC, id DESC" -- the tiebreaker
-- follows the key rather than being fixed at DESC -- and those two are exact reverses of
-- each other, which is what one btree read forwards and backwards can answer. Two columns
-- disagreeing about direction would need an index apiece; that is the whole reason
-- `ORDER_BY` in `listing.repository.ts` is written the way it is, and changing it means
-- changing this file with it.
CREATE INDEX "listings_offered_price_id_idx"
  ON "listings" ("price_per_night", "id")
  WHERE "deleted_at" IS NULL;
