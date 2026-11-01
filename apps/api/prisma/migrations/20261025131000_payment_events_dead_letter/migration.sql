-- The inbox counts the runs that failed an event and sets one aside after too many, rather
-- than handing it back to the queue for good: an event that fails the same way every time
-- (a handler's bug, a refund the provider keeps refusing, a payload the schema no longer
-- reads) would otherwise be retried forever with nobody told.

-- AlterTable
ALTER TABLE "payment_events"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "failed_at" TIMESTAMP(3);

-- The sweep's read leaves the events set aside out as well, so the partial index narrows
-- by both columns. Still partial, and still raw SQL -- Prisma spells no WHERE on an index.
DROP INDEX "payment_events_unprocessed_idx";
CREATE INDEX "payment_events_unprocessed_idx" ON "payment_events"("received_at")
  WHERE "processed_at" IS NULL AND "failed_at" IS NULL;

-- What the daily prune deletes by.
-- CreateIndex
CREATE INDEX "payment_events_processed_at_idx" ON "payment_events"("processed_at");
