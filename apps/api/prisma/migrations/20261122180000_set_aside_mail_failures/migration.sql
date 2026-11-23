ALTER TABLE mail_events
    ADD COLUMN failed_at TIMESTAMP(3),
    ADD COLUMN last_error TEXT;

DROP INDEX mail_events_processed_at_available_at_idx;
CREATE INDEX mail_events_processed_at_failed_at_available_at_idx
    ON mail_events (processed_at, failed_at, available_at);

ALTER TABLE mail_outbox
    ADD COLUMN processing_failures INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN failed_at TIMESTAMP(3),
    ADD COLUMN last_error TEXT;

DROP INDEX mail_outbox_available_at_id_idx;
CREATE INDEX mail_outbox_failed_at_available_at_id_idx
    ON mail_outbox (failed_at, available_at, id);

-- Rebuild unsent admin mail. Set aside requests that may have reached Resend.
UPDATE mail_outbox AS task
SET delivery_snapshot = NULL,
    failed_at = CASE WHEN task.send_attempts > 0 THEN CURRENT_TIMESTAMP END,
    last_error = CASE WHEN task.send_attempts > 0
                      THEN 'Previous mail payload may contain internal diagnostics' END
FROM notifications AS notice
WHERE task.kind = 'notice' AND task.id = notice.id
  AND notice.type IN ('CANCELLATION_REFUND_FAILED', 'PAYOUT_FAILED')
  AND task.delivery_snapshot IS NOT NULL;
