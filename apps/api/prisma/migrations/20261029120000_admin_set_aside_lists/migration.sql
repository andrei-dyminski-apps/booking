-- What the money paths set aside becomes something an admin reads and acts on over HTTP
-- instead of in SQL: the events the inbox gave up on, the refunds a guest's bank sent back,
-- and the owed refunds and host payouts that stopped retrying.

-- AlterTable
-- How the money went back, written with `resolved_at` and never without it: a resolved
-- failure with nothing said about it is no record, and a note on an open one is a claim
-- nobody acted on.
ALTER TABLE "refund_failures" ADD COLUMN "resolution" TEXT;

-- Until now a failure was resolved in SQL by stamping `resolved_at` alone, so the rows
-- resolved that way say so rather than fail the constraint below.
UPDATE "refund_failures"
SET "resolution" = 'Resolved before the API recorded how'
WHERE "resolved_at" IS NOT NULL;

ALTER TABLE "refund_failures"
  ADD CONSTRAINT "refund_failures_resolution_with_resolved_at"
  CHECK (("resolved_at" IS NULL) = ("resolution" IS NULL));

-- CreateIndex
-- Both lists of refund failures, newest first; the table holds one row per bounced refund,
-- so one index serves the open and the resolved alike.
CREATE INDEX "refund_failures_failed_at_refund_id_idx" ON "refund_failures"("failed_at" DESC, "refund_id" DESC);

-- The three lists below read rows that are rare by design out of tables that are not, so
-- each index holds only what was set aside. Partial and raw SQL, like the sweeps' indexes
-- -- Prisma spells no WHERE on an index.
CREATE INDEX "payment_events_failed_idx" ON "payment_events"("failed_at" DESC, "id" DESC)
  WHERE "failed_at" IS NOT NULL;

CREATE INDEX "bookings_refund_failed_idx" ON "bookings"("refund_failed_at" DESC, "id" DESC)
  WHERE "refund_failed_at" IS NOT NULL;

CREATE INDEX "bookings_payout_failed_idx" ON "bookings"("payout_failed_at" DESC, "id" DESC)
  WHERE "payout_failed_at" IS NOT NULL;
