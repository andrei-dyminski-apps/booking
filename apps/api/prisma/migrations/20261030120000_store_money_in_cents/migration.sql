-- Money goes to whole cents, the unit Stripe charges, refunds and transfers in, so nothing
-- between the database and the provider has to convert: 120.50 becomes 12050. Every money
-- column names its unit as the contract's fields do — `amount` read off a row is a number
-- of something, `amount_cents` is not a guess. The `USING` clauses migrate the data along
-- with the type; the scale was the cent, so the multiplication is exact and the cast drops
-- nothing.
--
-- `integer` is wide enough: a night and a stay are capped at 99 999 999 cents below —
-- the contract's `MAX_PRICE` and Stripe's ceiling for one charge (`MAX_CHARGE`), the same
-- number — and every other column of a booking is bounded by its amount.

-- The ceilings on a nightly price name the contract's `MAX_PRICE`, which is in cents now
-- too, so they are dropped before the rewrite and added back on the new columns. The
-- constraints on a booking compare its columns with each other and survive both the rewrite
-- and the rename — Postgres rewrites the expressions, the price index's too — and the
-- columns of a booking go in one statement so they are checked once, after all of them
-- have moved.
ALTER TABLE "listings" DROP CONSTRAINT "listings_price_within_contract";
ALTER TABLE "listing_weekday_prices" DROP CONSTRAINT "listing_weekday_prices_price_within_contract";
ALTER TABLE "listing_date_prices" DROP CONSTRAINT "listing_date_prices_price_within_contract";

-- The old ceiling let a price be 1 000 000.00, a cent above the new one, so a price at it
-- comes down to the new ceiling rather than fail the constraint it is added back with.
UPDATE "listings" SET "price_per_night" = 999999.99 WHERE "price_per_night" > 999999.99;
UPDATE "listing_weekday_prices" SET "price" = 999999.99 WHERE "price" > 999999.99;
UPDATE "listing_date_prices" SET "price" = 999999.99 WHERE "price" > 999999.99;

-- A stay above what one payment can carry was never paid through Stripe, which refuses
-- such a charge: it is one of the stays `add_payments` priced from the listing's prices
-- after the fact, uncapped. Brought down to the ceiling, it fits both `integer` and the
-- constraint below; every column of it goes down to the same ceiling, so what was refunded,
-- owed and paid out stays within the amount, as the constraints on a booking require. A
-- `CASE` rather than `LEAST`, which would turn a NULL into the ceiling.
UPDATE "bookings" SET
  "amount" = 999999.99,
  "refunded_amount" = CASE WHEN "refunded_amount" > 999999.99 THEN 999999.99 ELSE "refunded_amount" END,
  "refund_owed" = CASE WHEN "refund_owed" > 999999.99 THEN 999999.99 ELSE "refund_owed" END,
  "paid_out_amount" = CASE WHEN "paid_out_amount" > 999999.99 THEN 999999.99 ELSE "paid_out_amount" END
WHERE "amount" > 999999.99;

ALTER TABLE "listings"
  ALTER COLUMN "price_per_night" TYPE INTEGER USING ("price_per_night" * 100)::integer;
ALTER TABLE "listing_weekday_prices"
  ALTER COLUMN "price" TYPE INTEGER USING ("price" * 100)::integer;
ALTER TABLE "listing_date_prices"
  ALTER COLUMN "price" TYPE INTEGER USING ("price" * 100)::integer;

ALTER TABLE "bookings"
  ALTER COLUMN "amount" TYPE INTEGER USING ("amount" * 100)::integer,
  ALTER COLUMN "refunded_amount" TYPE INTEGER USING ("refunded_amount" * 100)::integer,
  ALTER COLUMN "refund_owed" TYPE INTEGER USING ("refund_owed" * 100)::integer,
  ALTER COLUMN "paid_out_amount" TYPE INTEGER USING ("paid_out_amount" * 100)::integer;

ALTER TABLE "refund_failures"
  ALTER COLUMN "amount" TYPE INTEGER USING ("amount" * 100)::integer;

ALTER TABLE "listings" RENAME COLUMN "price_per_night" TO "price_per_night_cents";
ALTER TABLE "listing_weekday_prices" RENAME COLUMN "price" TO "price_cents";
ALTER TABLE "listing_date_prices" RENAME COLUMN "price" TO "price_cents";

ALTER TABLE "bookings" RENAME COLUMN "amount" TO "amount_cents";
ALTER TABLE "bookings" RENAME COLUMN "refunded_amount" TO "refunded_amount_cents";
ALTER TABLE "bookings" RENAME COLUMN "refund_owed" TO "refund_owed_cents";
ALTER TABLE "bookings" RENAME COLUMN "paid_out_amount" TO "paid_out_amount_cents";

ALTER TABLE "refund_failures" RENAME COLUMN "amount" TO "amount_cents";

ALTER TABLE "listings"
  ADD CONSTRAINT "listings_price_within_contract"
  CHECK ("price_per_night_cents" > 0 AND "price_per_night_cents" <= 99999999);
ALTER TABLE "listing_weekday_prices"
  ADD CONSTRAINT "listing_weekday_prices_price_within_contract"
  CHECK ("price_cents" > 0 AND "price_cents" <= 99999999);
ALTER TABLE "listing_date_prices"
  ADD CONSTRAINT "listing_date_prices_price_within_contract"
  CHECK ("price_cents" > 0 AND "price_cents" <= 99999999);

-- `MAX_CHARGE` on the column, for the writes that go around the API as the price ceilings
-- are; it also bounds every other money column of a booking through its amount.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_amount_within_charge"
  CHECK ("amount_cents" <= 99999999);

-- A stay records the currency it was charged in. Every stay so far was charged in the
-- site's one currency, which is what the default writes into them; it is dropped right
-- after, so a new row has to say its currency rather than inherit one.
ALTER TABLE "bookings" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'usd';
ALTER TABLE "bookings" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_currency_supported" CHECK ("currency" IN ('usd'));

-- The nights behind a stay's amount. The stays taken before this table have none: what each
-- of their nights cost was never recorded, and today's prices would be a guess written down
-- as a fact.
CREATE TABLE "booking_nights" (
    "booking_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "price_cents" INTEGER NOT NULL,

    CONSTRAINT "booking_nights_pkey" PRIMARY KEY ("booking_id","date")
);

ALTER TABLE "booking_nights" ADD CONSTRAINT "booking_nights_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The ceiling of a nightly price, as on the listing's own price columns.
ALTER TABLE "booking_nights"
  ADD CONSTRAINT "booking_nights_price_within_contract"
  CHECK ("price_cents" > 0 AND "price_cents" <= 99999999);

-- The JSON that carries an amount moves with the columns, so nothing reads it in two units.
-- The payment events still in the inbox keep the name `amount`: their payload is the API's
-- own, typed as cents where it is read, and never crosses the wire.
UPDATE "payment_events"
SET "payload" = jsonb_set("payload", '{amount}', to_jsonb(round(("payload"->>'amount')::numeric * 100)::integer))
WHERE "payload"->>'kind' IN ('succeeded', 'refundFailed') AND "payload" ? 'amount';

UPDATE "payment_events"
SET "payload" = jsonb_set("payload", '{amountRefunded}', to_jsonb(round(("payload"->>'amountRefunded')::numeric * 100)::integer))
WHERE "payload"->>'kind' = 'refunded' AND "payload" ? 'amountRefunded';

-- The notices already written answer through the contract, whose field is `amountCents`.
UPDATE "notifications"
SET "data" = ("data" - 'amount')
  || jsonb_build_object('amountCents', round(("data"->>'amount')::numeric * 100)::integer)
WHERE "type" IN ('PAYMENT_REFUNDED', 'PAYOUT_SENT', 'REFUND_FAILED') AND "data" ? 'amount';
