-- CreateIndex
CREATE INDEX "waitlist_entries_from_date_id_idx" ON "waitlist_entries"("from_date", "id");

-- CreateIndex
CREATE INDEX "waitlist_entries_created_at_id_idx" ON "waitlist_entries"("created_at" DESC, "id" DESC);
