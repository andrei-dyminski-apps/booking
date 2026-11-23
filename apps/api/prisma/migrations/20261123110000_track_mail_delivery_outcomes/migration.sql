BEGIN;

ALTER TABLE "mail_events" ADD COLUMN "provider_failure_reason" TEXT;

ALTER TABLE "mail_outbox"
  ADD COLUMN "accepted_email_id" UUID,
  ADD COLUMN "provider_retry" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "mail_outbox_accepted_email_id_key" ON "mail_outbox"("accepted_email_id");
CREATE INDEX "mail_outbox_ready_idx" ON "mail_outbox"("available_at", "id")
  WHERE "failed_at" IS NULL AND "accepted_email_id" IS NULL;

-- Revoke superseded address changes and coalesce deferred links that never left the queue.
WITH latest_changes AS (
  SELECT id, rank() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS position,
    count(*) OVER (PARTITION BY user_id, created_at) AS requests_at_same_time
  FROM account_mail WHERE kind = 'change'
),
undelivered_links AS (
  SELECT letter.id, row_number() OVER (
    PARTITION BY letter.kind, letter.email, letter.user_id, letter.session_version
    ORDER BY letter.created_at DESC, letter.id DESC
  ) AS position
  FROM account_mail AS letter
  JOIN mail_outbox AS task ON task.id = letter.id
  WHERE letter.kind IN ('register', 'reset') AND task.kind = 'account'
    AND task.failed_at IS NULL AND task.send_attempts = 0 AND task.started_at IS NULL
),
revoked AS (
  DELETE FROM account_mail WHERE id IN (
    SELECT id FROM latest_changes WHERE position > 1 OR requests_at_same_time > 1
    UNION ALL
    SELECT id FROM undelivered_links WHERE position > 1
  )
  RETURNING id
)
DELETE FROM mail_outbox AS task USING revoked
WHERE task.kind = 'account' AND task.failed_at IS NULL AND task.id = revoked.id;

CREATE UNIQUE INDEX "account_mail_one_change_per_user_idx" ON "account_mail"("user_id")
  WHERE "kind" = 'change';

COMMIT;
