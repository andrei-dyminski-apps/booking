BEGIN;

ALTER TABLE mail_events
    ADD COLUMN recipient_ids UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN lookup_recipients BOOLEAN NOT NULL DEFAULT false;

-- Preserve routing for pending deliveries and remove addresses from all inbox rows.
UPDATE mail_events AS event
SET recipient_ids = ARRAY(
        SELECT u.id FROM users AS u
        JOIN (SELECT DISTINCT lower(address) AS email
              FROM unnest(event.recipients) AS addresses(address)) AS recipient
          ON recipient.email = u.email
        WHERE u.deleted_at IS NULL AND u.created_at <= event.created_at
    ),
    lookup_recipients = cardinality(event.recipients) = 0
WHERE event.kind <> 'email.received' AND event.processed_at IS NULL;

ALTER TABLE mail_events DROP COLUMN recipients;

COMMIT;
