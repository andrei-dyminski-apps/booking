/*
  Warnings:

  - You are about to drop the column `guest_name` on the `bookings` table. All the data in the column will be lost.
  - You are about to drop the column `room_id` on the `bookings` table. All the data in the column will be lost.
  - Added the required column `guest_id` to the `bookings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `listing_id` to the `bookings` table without a default value. This is not possible if the table is not empty.

  The last two are not a warning to work around but the shape of this change: a booking of
  a `room_id` string cannot be turned into a booking of a listing row, because the listings
  do not exist yet. `db:deploy` therefore only applies cleanly while `bookings` is empty,
  which it is everywhere this has run — nothing is deployed yet. Once something is, a
  change of this kind needs three migrations instead: add the columns nullable, backfill,
  then make them required.

*/
-- DropIndex
DROP INDEX "bookings_room_id_from_date_to_date_idx";

-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "guest_name",
DROP COLUMN "room_id",
ADD COLUMN     "guest_id" UUID NOT NULL,
ADD COLUMN     "listing_id" UUID NOT NULL;

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price_per_night" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listings_owner_id_idx" ON "listings"("owner_id");

-- CreateIndex
CREATE INDEX "bookings_listing_id_from_date_to_date_idx" ON "bookings"("listing_id", "from_date", "to_date");

-- CreateIndex
CREATE INDEX "bookings_guest_id_idx" ON "bookings"("guest_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
