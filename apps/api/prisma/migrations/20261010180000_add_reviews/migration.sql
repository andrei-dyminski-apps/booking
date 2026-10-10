-- CreateEnum
CREATE TYPE "ReviewKind" AS ENUM ('LISTING', 'GUEST');

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" "ReviewKind" NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_booking_id_kind_key" ON "reviews"("booking_id", "kind");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The bounds of a rating are the contract's (`MIN_RATING` and `MAX_RATING` in
-- `@repo/contracts`), said again on the column for the reason the ceiling on a price is
-- (`bound_prices_to_the_contract`): nothing over HTTP reaches this -- `createReviewSchema`
-- answers 400 first -- but the seed and psql do, and a rating of 0 or 6 would be refused
-- by `reviewSchema` on the way out and take a whole page of reviews down with it.
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_within_contract"
  CHECK ("rating" BETWEEN 1 AND 5);
