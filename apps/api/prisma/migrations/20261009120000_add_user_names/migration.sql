-- Accounts get a name, which the filter boxes suggest instead of an address. The column is
-- added nullable, filled for the rows that already exist and only then made NOT NULL, so
-- a database with accounts in it migrates rather than refusing the constraint. What an
-- existing account is given is the part of its address before the `@` — something its
-- owner recognises, and nothing the address does not already say.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "name" TEXT;

UPDATE "users" SET "name" = split_part("email", '@', 1);

ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;

-- CreateIndex
CREATE INDEX "users_name_trgm_idx" ON "users" USING GIN ("name" gin_trgm_ops);
