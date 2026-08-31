-- `GET /bookings` becomes a keyset page, and these are the pairs it is cut along: each one
-- is an ordering `ORDER_BY` in `booking.repository.ts` names and a cursor
-- `booking-cursor.ts` encodes, so the three change together. Two indexes per scope rather
-- than four, because the tiebreaker follows the direction of the key -- `created_at DESC,
-- id DESC` and its ascending reverse are one btree read both ways, the same arithmetic as
-- the catalogue's two.
--
-- None of them is partial and none needs raw SQL, unlike the catalogue's: every status is
-- readable here -- a cancelled stay is a record its guest keeps -- so no predicate narrows
-- these reads the way `deleted_at IS NULL` narrows a listing.
--
-- The plain pair serves the admin's scope, which is every stay on the site and the only
-- one of the three with no ceiling on it. Behind `guest_id` it serves a guest's own
-- history, which is why the bare index on that column goes: it was the prefix of both.
--
-- The owner's scope deliberately gets none. It narrows by `listings.owner_id`, a column of
-- another table, so no index of this one can hold the filter and the ordering at once; a
-- denormalised `owner_id` here would buy that and cost a column to keep in step with every
-- listing that changes hands. What bounds that scope meanwhile is the owner's own listings
-- rather than the whole site.

-- DropIndex
DROP INDEX "bookings_guest_id_idx";

-- CreateIndex
CREATE INDEX "bookings_created_at_id_idx" ON "bookings"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "bookings_from_date_id_idx" ON "bookings"("from_date" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "bookings_guest_id_created_at_id_idx" ON "bookings"("guest_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "bookings_guest_id_from_date_id_idx" ON "bookings"("guest_id", "from_date" DESC, "id" DESC);
