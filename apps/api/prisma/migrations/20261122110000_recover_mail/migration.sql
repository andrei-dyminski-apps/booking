ALTER TABLE mail_events
    ADD COLUMN recipients TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX mail_events_processed_at_available_at_idx
    ON mail_events (processed_at, available_at);

CREATE TABLE mail_confirmations (
    hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    expires_at TIMESTAMP(3) NOT NULL
);

CREATE INDEX mail_confirmations_user_id_expires_at_idx
    ON mail_confirmations (user_id, expires_at);
