-- AlterTable
ALTER TABLE "users" ADD COLUMN     "blocked_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "users_created_at_id_idx" ON "users"("created_at" DESC, "id" DESC);
