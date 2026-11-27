-- CreateEnum
CREATE TYPE "PushTaskKind" AS ENUM ('notice', 'message');

-- CreateEnum
CREATE TYPE "PushTaskOutcome" AS ENUM ('dispatched', 'read', 'muted', 'limited', 'stale', 'untargeted', 'off', 'failed');

-- CreateEnum
CREATE TYPE "PushDeliveryStatus" AS ENUM ('pending', 'sent', 'gone', 'rejected', 'expired', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_endpoint_holds" (
    "endpoint_hash" TEXT NOT NULL,
    "user_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "retry_after" TIMESTAMP(3),

    CONSTRAINT "push_endpoint_holds_pkey" PRIMARY KEY ("endpoint_hash")
);

-- CreateTable
CREATE TABLE "push_preferences" (
    "user_id" UUID NOT NULL,
    "muted_groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quiet_from" INTEGER,
    "quiet_to" INTEGER,
    "time_zone" TEXT,
    "hourly_limit" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "push_tasks" (
    "id" UUID NOT NULL,
    "kind" "PushTaskKind" NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "waiting_for_quiet_hours" BOOLEAN NOT NULL DEFAULT false,
    "leased_until" TIMESTAMP(3),
    "generation" INTEGER NOT NULL DEFAULT 0,
    "subscription_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "outcome" "PushTaskOutcome",
    "finished_at" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "push_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_deliveries" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "subscription_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "waiting_for_quiet_hours" BOOLEAN NOT NULL DEFAULT false,
    "leased_until" TIMESTAMP(3),
    "generation" INTEGER NOT NULL DEFAULT 0,
    "status" "PushDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "response_status" INTEGER,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "clicked_at" TIMESTAMP(3),

    CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_created_at_idx" ON "push_subscriptions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "push_endpoint_holds_expires_at_idx" ON "push_endpoint_holds"("expires_at");

-- CreateIndex
CREATE INDEX "push_tasks_user_id_last_attempt_at_idx" ON "push_tasks"("user_id", "last_attempt_at");

-- CreateIndex
CREATE INDEX "push_deliveries_task_id_idx" ON "push_deliveries"("task_id");

-- CreateIndex
CREATE INDEX "push_deliveries_subscription_id_idx" ON "push_deliveries"("subscription_id");

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_preferences" ADD CONSTRAINT "push_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "push_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "push_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- What the relay claims: the unfinished rows, by when they are due. Partial, so the
-- finished history kept for the hourly limit and the receipts does not grow the scan.
CREATE INDEX "push_tasks_due_idx" ON "push_tasks"("available_at") WHERE "outcome" IS NULL;
CREATE INDEX "push_deliveries_due_idx" ON "push_deliveries"("available_at") WHERE "status" = 'pending';
-- What the hourly prune deletes: the finished tasks, by when they finished. Partial, so the
-- unfinished rows the relay claims stay out of it, as the due index leaves the finished out.
CREATE INDEX "push_tasks_finished_idx" ON "push_tasks"("finished_at") WHERE "outcome" IS NOT NULL;

-- The contract's bounds on the preferences, for the writes that go around the API: a row
-- outside them would answer GET /push/settings with what the frontend's parse refuses.
ALTER TABLE "push_preferences"
  ADD CONSTRAINT "push_preferences_quiet_hours_together"
    CHECK (("quiet_from" IS NULL) = ("quiet_to" IS NULL)
       AND ("quiet_to" IS NULL) = ("time_zone" IS NULL)),
  ADD CONSTRAINT "push_preferences_quiet_hours_within_day"
    CHECK ("quiet_from" BETWEEN 0 AND 1439 AND "quiet_to" BETWEEN 0 AND 1439),
  ADD CONSTRAINT "push_preferences_quiet_hours_apart"
    CHECK ("quiet_from" <> "quiet_to"),
  -- MAX_PUSH_HOURLY_LIMIT of the contract; the two move together.
  ADD CONSTRAINT "push_preferences_hourly_limit_within_contract"
    CHECK ("hourly_limit" BETWEEN 1 AND 60);
