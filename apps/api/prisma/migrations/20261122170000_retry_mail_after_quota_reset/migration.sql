ALTER TABLE "mail_outbox"
    ADD COLUMN "delivery_snapshot" TEXT,
    ADD COLUMN "delivery_round" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "send_attempts" INTEGER NOT NULL DEFAULT 0;

-- An old worker could have sent any request it started.
UPDATE "mail_outbox" SET "send_attempts" = 1 WHERE "started_at" IS NOT NULL;
