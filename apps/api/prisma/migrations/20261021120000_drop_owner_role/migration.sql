-- Hosting is no longer a role: whoever owns a listing hosts it, whatever the account's
-- role. The former owners become plain users before the cast below, which would refuse
-- a row still holding 'OWNER' — inside the same transaction, so a failed cast leaves the
-- roles as they were.
-- AlterEnum
BEGIN;
UPDATE "users" SET "role" = 'USER' WHERE "role" = 'OWNER';
CREATE TYPE "Role_new" AS ENUM ('USER', 'ADMIN');
ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';
COMMIT;
