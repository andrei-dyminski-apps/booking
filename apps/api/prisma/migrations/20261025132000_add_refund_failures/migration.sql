-- A refund the guest's bank sent back used to be a log line and nothing else. It is a row
-- now, kept until a person issues the refund again, and the admins are told about it --
-- as they are about a payment event the worker gave up on.

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
