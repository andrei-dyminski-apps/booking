-- The webhook ledger becomes an inbox: a delivery is written here and answered at once, and a
-- worker handles it afterwards. Every row already here was handled before it was written, so
-- it is processed as of its arrival, with the event's kind unknown to the inbox's schema.

-- AlterTable
ALTER TABLE "payment_events"
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "processed_at" TIMESTAMP(3);

UPDATE "payment_events"
SET "payload" = jsonb_build_object('kind', 'other', 'eventId', "id", 'type', "type"),
    "processed_at" = "received_at";

ALTER TABLE "payment_events" ALTER COLUMN "payload" SET NOT NULL;

-- What the sweep reads every minute: the few events a lost job left unprocessed. Partial,
-- because nearly every row is processed within a second of arriving -- and Prisma spells no
-- WHERE on an index.
CREATE INDEX "payment_events_unprocessed_idx" ON "payment_events"("received_at")
  WHERE "processed_at" IS NULL;
