-- CreateEnum
CREATE TYPE "Canceller" AS ENUM ('GUEST', 'HOST', 'ADMIN');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYOUT_SHORTFALL';
ALTER TYPE "NotificationType" ADD VALUE 'HOST_CANCELLATION_FEE';
ALTER TYPE "NotificationType" ADD VALUE 'HOST_CANCELLATIONS_THRESHOLD';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by" "Canceller",
ADD COLUMN     "fee_withheld_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payout_reserved_cents" INTEGER,
ADD COLUMN     "payout_reservations" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "host_fees" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "withheld_cents" INTEGER NOT NULL DEFAULT 0,
    "waived_at" TIMESTAMP(3),
    "waive_reason" TEXT,
    "waived_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_fee_withholdings" (
    "booking_id" UUID NOT NULL,
    "host_fee_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,

    CONSTRAINT "host_fee_withholdings_pkey" PRIMARY KEY ("booking_id","host_fee_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "host_fees_booking_id_key" ON "host_fees"("booking_id");

-- CreateIndex
CREATE INDEX "host_fees_host_id_created_at_idx" ON "host_fees"("host_id", "created_at");

-- CreateIndex
CREATE INDEX "host_fee_withholdings_host_fee_id_idx" ON "host_fee_withholdings"("host_fee_id");

-- AddForeignKey
ALTER TABLE "host_fees" ADD CONSTRAINT "host_fees_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_fees" ADD CONSTRAINT "host_fees_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_fees" ADD CONSTRAINT "host_fees_waived_by_id_fkey" FOREIGN KEY ("waived_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_fee_withholdings" ADD CONSTRAINT "host_fee_withholdings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_fee_withholdings" ADD CONSTRAINT "host_fee_withholdings_host_fee_id_fkey" FOREIGN KEY ("host_fee_id") REFERENCES "host_fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A host's fee is a positive amount of a currency the contract knows, withheld at most in
-- full, and waived with a reason and by an admin or not at all — for the writes that go
-- around the API.
ALTER TABLE "host_fees"
  ADD CONSTRAINT "host_fees_amount_positive" CHECK ("amount_cents" > 0),
  ADD CONSTRAINT "host_fees_withheld_within_amount"
    CHECK ("withheld_cents" >= 0 AND "withheld_cents" <= "amount_cents"),
  ADD CONSTRAINT "host_fees_waived_with_reason"
    CHECK (("waived_at" IS NULL) = ("waive_reason" IS NULL)),
  ADD CONSTRAINT "host_fees_waived_by_someone"
    CHECK (("waived_at" IS NULL) = ("waived_by_id" IS NULL)),
  ADD CONSTRAINT "host_fees_currency_supported" CHECK ("currency" IN ('usd'));

-- A row taken back whole is deleted rather than left at zero, so every row is money a payout
-- kept back — for the writes that go around the API.
ALTER TABLE "host_fee_withholdings"
  ADD CONSTRAINT "host_fee_withholdings_amount_positive" CHECK ("amount_cents" > 0);

-- What a payout kept back is never negative, and the canceller, the moment and the reason
-- are written together with `CANCELLED` — the reason is optional, the moment is not.
-- A reservation is a payout under way: never negative, gone once the payout is recorded, and
-- the only state besides a recorded payout in which a stay may keep back towards fees. The
-- reservation counter only grows from zero, and a reservation under way has been counted —
-- its number is the transfer's idempotency key.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_fee_withheld_not_negative" CHECK ("fee_withheld_cents" >= 0),
  ADD CONSTRAINT "bookings_cancelled_by_with_cancelled_at"
    CHECK (("cancelled_by" IS NULL) = ("cancelled_at" IS NULL)),
  ADD CONSTRAINT "bookings_payout_reserved_not_negative"
    CHECK ("payout_reserved_cents" IS NULL OR "payout_reserved_cents" >= 0),
  ADD CONSTRAINT "bookings_payout_reserved_until_paid_out"
    CHECK ("payout_reserved_cents" IS NULL OR "paid_out_at" IS NULL),
  ADD CONSTRAINT "bookings_fee_withheld_by_a_payout"
    CHECK ("fee_withheld_cents" = 0 OR "paid_out_at" IS NOT NULL OR "payout_reserved_cents" IS NOT NULL),
  ADD CONSTRAINT "bookings_payout_reservations_not_negative" CHECK ("payout_reservations" >= 0),
  ADD CONSTRAINT "bookings_payout_reserved_counted"
    CHECK ("payout_reserved_cents" IS NULL OR "payout_reservations" > 0);

-- A payout that withholds the whole share sends no transfer, so whether a stay was paid out
-- is `paid_out_at` rather than `transfer_id`: the sweep's index follows it.
DROP INDEX "bookings_awaiting_payout_idx";
CREATE INDEX "bookings_awaiting_payout_idx" ON "bookings"("payout_attempts", "from_date")
  WHERE "paid_at" IS NOT NULL AND "paid_out_at" IS NULL AND "payout_failed_at" IS NULL;
