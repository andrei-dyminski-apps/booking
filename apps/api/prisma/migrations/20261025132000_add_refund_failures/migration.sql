-- A refund the guest's bank sent back used to be a log line and nothing else. It is a row
-- now, kept until a person issues the refund again, and the admins are told about it --
-- as they are about a payment event the worker gave up on. The row names its stay with a key
-- that lets go of it (SET NULL): money still owed to a guest must not vanish with whatever
-- deletes a booking row.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REFUND_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_EVENT_FAILED';

-- CreateTable
CREATE TABLE "refund_failures" (
    "refund_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "booking_id" UUID,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "refund_failures_pkey" PRIMARY KEY ("refund_id")
);

-- CreateIndex
CREATE INDEX "refund_failures_booking_id_idx" ON "refund_failures"("booking_id");

-- AddForeignKey
ALTER TABLE "refund_failures" ADD CONSTRAINT "refund_failures_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
