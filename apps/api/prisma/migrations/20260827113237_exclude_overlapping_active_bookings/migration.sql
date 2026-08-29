-- The last line of defence against a double booking: even a bug in the service cannot
-- write two overlapping active stays on one listing. Prisma cannot express an EXCLUDE
-- constraint, so this migration is hand-written (see .claude/rules/backend.md).
--
-- btree_gist lets a GiST index mix the equality on "listing_id" with the range overlap.
-- The range is half-open, '[)': a stay that starts on the day another ends is not an
-- overlap — check-out is the morning the room is free again, the same rule the strict
-- inequalities of `overlapping` in BookingRepository already apply.
--
-- Only PENDING_PAYMENT and CONFIRMED take part: a cancelled or expired booking keeps its
-- row (phase 6 refunds need it) but no longer holds the slot.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "listing_id" WITH =,
    daterange("from_date", "to_date", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING_PAYMENT', 'CONFIRMED'));
