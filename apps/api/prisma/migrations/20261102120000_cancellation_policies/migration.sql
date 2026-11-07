-- A cancellation policy per listing, copied onto every booking when it is taken.
CREATE TYPE "CancellationPolicy" AS ENUM ('FLEXIBLE', 'MODERATE', 'LIMITED', 'FIRM', 'NON_REFUNDABLE');

-- `FLEXIBLE` is the rule every listing and stay was under until now, so no stay already taken
-- changes its terms.
ALTER TABLE "listings"
  ADD COLUMN "cancellation_policy" "CancellationPolicy" NOT NULL DEFAULT 'FLEXIBLE';

-- Backfilled through a default that is dropped right after: a new booking has to name the
-- policy it copied, never fall back to one.
ALTER TABLE "bookings"
  ADD COLUMN "cancellation_policy" "CancellationPolicy" NOT NULL DEFAULT 'FLEXIBLE';
ALTER TABLE "bookings" ALTER COLUMN "cancellation_policy" DROP DEFAULT;
