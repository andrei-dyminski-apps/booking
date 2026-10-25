-- The lease a cancellation holds a stay by, in place of an advisory lock held by an open
-- transaction: the work under it calls Stripe, and must not pin a connection while it does.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "cancelling_until" TIMESTAMP(3);
