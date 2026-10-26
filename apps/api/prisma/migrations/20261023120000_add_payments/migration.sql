-- Phase 6: a booking carries what it costs and the payment that settles it.
--
-- "amount" is required, so the rows already there need one before the column can refuse a
-- NULL. It is worked out the way the API now quotes a hold -- a date's own price, then its
-- weekday's, then the listing's default, night by night -- but from the prices as they
-- stand today: past date prices are dropped at a listing's next save, so for an old stay
-- this is a reconstruction rather than a record. Nothing was ever charged for those rows,
-- which is what makes a reconstruction good enough.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_REFUNDED';

-- AlterTable
ALTER TABLE "bookings"
  ADD COLUMN "amount" DECIMAL(10,2),
  ADD COLUMN "payment_intent_id" TEXT,
  ADD COLUMN "paid_at" TIMESTAMP(3),
  ADD COLUMN "refunded_amount" DECIMAL(10,2);

UPDATE "bookings" AS b
SET "amount" = (
  SELECT COALESCE(SUM(COALESCE(dp."price", wp."price", l."price_per_night")), 0)
  FROM generate_series(b."from_date", b."to_date" - 1, INTERVAL '1 day') AS night(day)
  JOIN "listings" AS l ON l."id" = b."listing_id"
  LEFT JOIN "listing_date_prices" AS dp
    ON dp."listing_id" = l."id" AND dp."date" = night.day::date
  -- ISO day 1 is Monday, the first value of the enum, as in the contract's week.
  LEFT JOIN "listing_weekday_prices" AS wp
    ON wp."listing_id" = l."id"
    AND wp."weekday" = (enum_range(NULL::"Weekday"))[EXTRACT(ISODOW FROM night.day)::int]
);

ALTER TABLE "bookings" ALTER COLUMN "amount" SET NOT NULL;

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_payment_intent_id_key" ON "bookings"("payment_intent_id");
