-- DropIndex
DROP INDEX "refresh_tokens_user_id_idx";

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_expires_at_idx" ON "refresh_tokens"("user_id", "expires_at");
