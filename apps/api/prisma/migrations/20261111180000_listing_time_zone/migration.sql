-- Every listing and every stay so far began at midnight UTC of its check-in day, so that is
-- what they are backfilled with: nothing already booked moves. The bookings' defaults are
-- dropped at once, so `create` has to copy both off the listing, as it copies the policy.
ALTER TABLE "bookings" ADD COLUMN "time_zone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN "check_in_time" CHAR(5) NOT NULL DEFAULT '00:00';
ALTER TABLE "bookings" ALTER COLUMN "time_zone" DROP DEFAULT,
ALTER COLUMN "check_in_time" DROP DEFAULT;

-- A listing created from now on without a check-in time arrives at 15:00, not midnight.
ALTER TABLE "listings" ADD COLUMN "time_zone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN "check_in_time" CHAR(5) NOT NULL DEFAULT '00:00';
ALTER TABLE "listings" ALTER COLUMN "check_in_time" SET DEFAULT '15:00';

-- The format `checkInTimeSchema` holds a request to, for the writes that go around the API.
ALTER TABLE "listings"
  ADD CONSTRAINT "listings_check_in_time_format"
  CHECK ("check_in_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_check_in_time_format"
  CHECK ("check_in_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- The moment each stay begins, stored so the payout sweep can cut by when a payout falls
-- due. A cut by `from_date` alone has to leave room for every zone, which lets in stays not
-- due for two more days, and those fill the sweep's batch ahead of the ones that are.
-- From now on `create` writes it from `checkInInstant`; the rows already there are
-- backfilled by Postgres's own zone rules, which agree with it for every stay so far.
ALTER TABLE "bookings" ADD COLUMN "check_in_at" TIMESTAMP(3);

UPDATE "bookings"
SET "check_in_at" =
  (("from_date" + "check_in_time"::time) AT TIME ZONE "time_zone") AT TIME ZONE 'UTC';

ALTER TABLE "bookings" ALTER COLUMN "check_in_at" SET NOT NULL;

DROP INDEX "bookings_awaiting_payout_idx";
CREATE INDEX "bookings_awaiting_payout_idx" ON "bookings"("payout_attempts", "check_in_at")
  WHERE "paid_at" IS NOT NULL AND "paid_out_at" IS NULL AND "payout_failed_at" IS NULL;

-- When a waitlist entry's check-in day ends where its listing is — what every read of the
-- list drops an entry by, written by `join` from `checkInDayEnd`. The entries already there
-- were read by the UTC day, so they end at midnight UTC after it, as they did.
ALTER TABLE "waitlist_entries" ADD COLUMN "check_in_day_ends_at" TIMESTAMP(3);

UPDATE "waitlist_entries"
SET "check_in_day_ends_at" = ("from_date" + 1)::timestamp;

ALTER TABLE "waitlist_entries" ALTER COLUMN "check_in_day_ends_at" SET NOT NULL;
