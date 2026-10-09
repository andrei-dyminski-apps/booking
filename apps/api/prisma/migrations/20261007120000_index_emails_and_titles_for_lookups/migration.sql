-- The filter boxes look an account up by any part of its address and a listing by any part
-- of its title, and a "%part%" is a pattern no btree can seek. A trigram index can, for
-- LIKE and ILIKE alike, which is why both columns get one: the lookups of the filter boxes
-- and the existing `email` filter of GET /users all read through them.
--
-- The indexes themselves are declared on the models; the extension is not, because Prisma
-- no longer manages extensions -- so it is installed here, like btree_gist before it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "listings_title_trgm_idx" ON "listings" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_email_trgm_idx" ON "users" USING GIN ("email" gin_trgm_ops);
