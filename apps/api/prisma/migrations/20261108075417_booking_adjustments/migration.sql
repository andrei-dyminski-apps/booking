-- CreateTable
CREATE TABLE "booking_adjustments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "refund_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_adjustments_refund_id_key" ON "booking_adjustments"("refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_adjustments_booking_id_request_id_key" ON "booking_adjustments"("booking_id", "request_id");

-- AddForeignKey
ALTER TABLE "booking_adjustments" ADD CONSTRAINT "booking_adjustments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_adjustments" ADD CONSTRAINT "booking_adjustments_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An adjustment gives back a positive amount of a currency the contract knows — for the
-- writes that go around the API.
ALTER TABLE "booking_adjustments"
  ADD CONSTRAINT "booking_adjustments_amount_positive" CHECK ("amount_cents" > 0),
  ADD CONSTRAINT "booking_adjustments_currency_supported" CHECK ("currency" IN ('usd'));
