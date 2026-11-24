BEGIN;

-- Renaming the enum values also updates the existing booking rows.
ALTER TYPE "Canceller" RENAME VALUE 'GUEST' TO 'guest';
ALTER TYPE "Canceller" RENAME VALUE 'HOST' TO 'host';
ALTER TYPE "Canceller" RENAME VALUE 'ADMIN' TO 'admin';

-- Notifications store their own snapshots of the actor in JSON.
UPDATE "notifications"
SET "data" = jsonb_set("data", '{cancelledBy}', to_jsonb(lower("data"->>'cancelledBy')))
WHERE "type" = 'BOOKING_CANCELLED'
  AND "data"->>'cancelledBy' IN ('GUEST', 'HOST', 'ADMIN');

UPDATE "notifications"
SET "data" = jsonb_set("data", '{endedBy}', to_jsonb(lower("data"->>'endedBy')))
WHERE "type" = 'STAY_ENDED_EARLY'
  AND "data"->>'endedBy' IN ('GUEST', 'HOST', 'ADMIN');

COMMIT;
