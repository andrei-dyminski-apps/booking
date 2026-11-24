ALTER TABLE "mail_outbox"
    ADD COLUMN "started_at" TIMESTAMP(3),
    ADD COLUMN "digest_snapshot" JSONB;

ALTER TABLE "mail_events" ADD COLUMN "reply_token_hash" TEXT;

-- The inbox can retrieve recipients again for pending events from older versions.
UPDATE "mail_events"
SET "recipients" = '{}'
WHERE "kind" = 'email.received' AND cardinality("recipients") > 0;

UPDATE "users"
SET "muted_mail_groups" = ARRAY['stays', 'payments', 'waitlist', 'messages']::TEXT[]
WHERE "deleted_at" IS NULL
  AND "muted_mail_groups" IS DISTINCT FROM
      ARRAY['stays', 'payments', 'waitlist', 'messages']::TEXT[];
