-- Host payouts: the guest pays the platform, and the host is paid their share by a separate
-- transfer once the stay has begun. A user carries the Stripe connected account they are
-- paid to; a booking carries the charge the transfer is funded by, the transfer itself and
-- what the host still holds of it, and where a dispute of the payment stands.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_DISPUTED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYOUT_SENT';

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "stripe_account_id" TEXT,
  ADD COLUMN "payouts_enabled_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "bookings"
  ADD COLUMN "charge_id" TEXT,
  ADD COLUMN "transfer_id" TEXT,
  ADD COLUMN "paid_out_amount" DECIMAL(10,2),
  ADD COLUMN "paid_out_at" TIMESTAMP(3),
  ADD COLUMN "dispute_status" "DisputeStatus";

-- CreateIndex
CREATE UNIQUE INDEX "users_stripe_account_id_key" ON "users"("stripe_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_transfer_id_key" ON "bookings"("transfer_id");

-- What the payout sweep asks every hour: the paid stays nobody has transferred anything
-- for yet, by check-in. Partial, because that is a handful of rows out of every stay there
-- ever was -- once a transfer is written a row leaves the index for good -- and Prisma
-- spells no WHERE on an index, the reason the catalogue's indexes are raw SQL too.
CREATE INDEX "bookings_awaiting_payout_idx" ON "bookings"("from_date")
  WHERE "paid_at" IS NOT NULL AND "transfer_id" IS NULL;
