-- What a cancellation decided to give back and has not sent yet: the cancellation writes it
-- with CANCELLED, and the refund-cancellation job sends the refund and clears it.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "refund_owed" DECIMAL(10,2);

-- What the sweep reads when a job was lost or Stripe refused it for a while. Partial,
-- because a refund is owed for seconds and nearly every row has none -- and Prisma spells
-- no WHERE on an index.
CREATE INDEX "bookings_refund_owed_idx" ON "bookings"("id")
  WHERE "refund_owed" IS NOT NULL;
