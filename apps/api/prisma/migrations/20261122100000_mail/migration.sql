ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP(3),
    ADD COLUMN email_undeliverable_at TIMESTAMP(3),
    ADD COLUMN confirmation_hash TEXT UNIQUE,
    ADD COLUMN confirmation_expires_at TIMESTAMP(3),
    ADD COLUMN muted_mail_groups TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN inbound_email_id TEXT UNIQUE;
CREATE TABLE mail_events (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, email_id TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL, processed_at TIMESTAMP(3)
);
