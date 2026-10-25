-- The owed refunds and the host payouts count their failed runs and are set aside after too
-- many, the way the payment inbox is: one that fails the same way every time would otherwise
-- be retried for good with nobody told, and stay at the head of its sweep's batch.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CANCELLATION_REFUND_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYOUT_FAILED';

-- AlterTable
ALTER TABLE "bookings"
  ADD COLUMN "refund_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refund_last_error" TEXT,
  ADD COLUMN "refund_failed_at" TIMESTAMP(3),
  ADD COLUMN "payout_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "payout_last_error" TEXT,
  ADD COLUMN "payout_failed_at" TIMESTAMP(3);

-- Both sweeps read the fewest failures first and leave what was set aside out. Partial and
-- raw SQL, like the indexes they replace -- Prisma spells no WHERE on an index.
DROP INDEX "bookings_refund_owed_idx";
CREATE INDEX "bookings_refund_owed_idx" ON "bookings"("refund_attempts", "id")
  WHERE "refund_owed" IS NOT NULL AND "refund_failed_at" IS NULL;

DROP INDEX "bookings_awaiting_payout_idx";
CREATE INDEX "bookings_awaiting_payout_idx" ON "bookings"("payout_attempts", "from_date")
  WHERE "paid_at" IS NOT NULL AND "transfer_id" IS NULL AND "payout_failed_at" IS NULL;
