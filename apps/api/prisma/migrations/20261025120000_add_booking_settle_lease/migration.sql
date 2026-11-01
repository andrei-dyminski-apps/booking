-- The lease a settlement of the host's payout holds a stay by, in place of an advisory lock
-- held by an open transaction: the work under it calls Stripe, and must not pin a connection.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "settling_until" TIMESTAMP(3);
