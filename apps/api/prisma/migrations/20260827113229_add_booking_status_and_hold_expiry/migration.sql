-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT';

-- The default describes a booking written from now on, not one written before this
-- migration: those are stays somebody already holds, and there is no payment step behind
-- them to wait for. Left at the default they would read as unpaid holds forever — with
-- `expires_at` null, no sweep matches them, so nothing would ever release or confirm one,
-- and phase 5 would go looking for a PaymentIntent that was never created.
UPDATE "bookings" SET "status" = 'CONFIRMED';

-- CreateIndex
CREATE INDEX "bookings_status_expires_at_idx" ON "bookings"("status", "expires_at");
