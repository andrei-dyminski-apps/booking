-- The first index this project has had to think about, and it is the catalogue's: every
-- read of "listings" outside a stay carries "deleted_at" IS NULL (phase 3), and the page
-- of phase 5 is ordered by the pair its keyset cursor carries. Both belong in the index,
-- and Prisma can express neither -- @@index takes no WHERE -- so this migration is
-- hand-written, like the EXCLUDE constraint of phase 4 (see .claude/rules/backend.md).
--
-- Partial on the predicate rather than merely including the column: a retired listing is
-- not in the catalogue at all, so it has no business taking up space in the index that
-- serves it. DESC on both columns matches "ORDER BY created_at DESC, id DESC", which is
-- what lets one index scan answer the first page and every page after it -- Postgres can
-- read a btree backwards, but not when the two columns disagree about direction.
--
-- The filters (price, capacity, availability) deliberately get no index of their own: they
-- narrow a scan the ordering already drives, and which of them is worth one is a question
-- for the query plans of real data rather than for a guess made the day they were written.
CREATE INDEX "listings_offered_created_at_id_idx"
  ON "listings" ("created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;
