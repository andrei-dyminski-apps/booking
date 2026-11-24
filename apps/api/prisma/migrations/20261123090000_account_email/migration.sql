CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE "users"
  ALTER COLUMN "email" TYPE CITEXT,
  ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "account_mail" (
  "id" UUID NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "email" CITEXT NOT NULL,
  "token_hash" TEXT,
  "user_id" UUID,
  "session_version" INTEGER,
  "next_path" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "account_mail_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "account_mail_token_hash_key" ON "account_mail"("token_hash");
CREATE INDEX "account_mail_expires_at_idx" ON "account_mail"("expires_at");
CREATE INDEX "account_mail_kind_email_created_at_idx" ON "account_mail"("kind", "email", "created_at");
CREATE INDEX "account_mail_user_id_idx" ON "account_mail"("user_id");

ALTER TABLE "mail_events" ADD COLUMN "outbox_id" UUID;
CREATE INDEX "mail_events_email_id_created_at_idx" ON "mail_events"("email_id", "created_at");
CREATE INDEX "mail_events_outbox_id_idx" ON "mail_events"("outbox_id");
