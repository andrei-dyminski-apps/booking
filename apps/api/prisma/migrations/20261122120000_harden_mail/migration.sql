ALTER TABLE users ADD COLUMN email_delivery_restored_at TIMESTAMP(3);
ALTER TABLE mail_confirmations ADD COLUMN recovery_checked_at TIMESTAMP(3);

CREATE TABLE mail_outbox (
    id UUID PRIMARY KEY,
    kind TEXT NOT NULL,
    user_id UUID NOT NULL,
    request_id TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX mail_outbox_available_at_id_idx ON mail_outbox (available_at, id);
CREATE INDEX mail_outbox_user_id_idx ON mail_outbox (user_id);

CREATE TABLE mail_reply_tokens (
    hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE ON UPDATE CASCADE,
    expires_at TIMESTAMP(3) NOT NULL,
    revoked_at TIMESTAMP(3)
);
CREATE INDEX mail_reply_tokens_user_id_expires_at_idx
    ON mail_reply_tokens (user_id, expires_at);
CREATE INDEX mail_reply_tokens_message_id_idx ON mail_reply_tokens (message_id);
