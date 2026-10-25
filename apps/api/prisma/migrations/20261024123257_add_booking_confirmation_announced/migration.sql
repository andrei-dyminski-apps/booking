-- When the webhook told both sides about a confirmation and scheduled the host's payout. A
-- redelivery repeats the two only while it is empty, so two deliveries racing tell them once.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "confirmation_announced_at" TIMESTAMP(3);

-- A stay confirmed before this column existed was announced by the delivery that confirmed it.
UPDATE "bookings" SET "confirmation_announced_at" = "paid_at" WHERE "paid_at" IS NOT NULL;
