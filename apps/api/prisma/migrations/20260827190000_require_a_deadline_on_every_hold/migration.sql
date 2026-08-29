-- A hold without a deadline is a row no predicate in the application can see, and the one
-- in the database can. Both halves of hold expiry are written around "expires_at":
-- lapsedHolds is "PENDING_PAYMENT AND expires_at <= now", holdsTheSlot is its complement,
-- and under SQL's three-valued logic a NULL deadline makes both of them NULL rather than
-- true or false -- so such a row would hold no slot in the catalogue, in the availability
-- read or in the overlap check inside the locking transaction, and no sweep would ever
-- reach it either. The EXCLUDE constraint "bookings_no_overlap" filters on the status
-- alone, so it would go on counting it: the catalogue would offer nights that POST
-- /bookings then refuses with a 409, for good.
--
-- Nothing writes such a row today -- BookingRepository.create always computes a deadline
-- -- so this is the invariant those predicates already assume, made checkable before
-- phase 6 hands the statuses to a Stripe webhook. CONFIRMED and the two terminal statuses
-- keep the right to a NULL: a stay that no longer holds by its deadline needs none, which
-- is what the seed writes and what the column's nullability is for.
--
-- Prisma cannot express a CHECK constraint, so this migration is hand-written like the
-- EXCLUDE constraint and the catalogue index before it (see .claude/rules/backend.md).

-- Belt and braces for a database that already holds one: a hold with no deadline never
-- held its slot, so EXPIRED is what the application already believed it to be. On the
-- databases this project has, the statement matches nothing.
UPDATE "bookings"
  SET "status" = 'EXPIRED'
  WHERE "status" = 'PENDING_PAYMENT' AND "expires_at" IS NULL;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_hold_has_deadline"
  CHECK ("status" <> 'PENDING_PAYMENT' OR "expires_at" IS NOT NULL);
