-- The money columns of a stay, held to what the code already keeps them to -- for the
-- writes that go around it (the seed, a later migration, psql), the reason the price
-- columns carry a CHECK of their own. Prisma cannot express a CHECK, so this is raw SQL.
--
-- `amount` is a quote of at least one night, and every night costs more than nothing.
-- What went back, what is still owed and what the host holds never exceed what the guest
-- paid; a debt of nothing is written as NULL, never as 0.

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_amount_positive"
  CHECK ("amount" > 0),
  ADD CONSTRAINT "bookings_refunded_within_amount"
  CHECK ("refunded_amount" IS NULL OR ("refunded_amount" >= 0 AND "refunded_amount" <= "amount")),
  ADD CONSTRAINT "bookings_refund_owed_within_amount"
  CHECK ("refund_owed" IS NULL OR ("refund_owed" > 0 AND "refund_owed" <= "amount")),
  ADD CONSTRAINT "bookings_paid_out_within_amount"
  CHECK ("paid_out_amount" IS NULL OR ("paid_out_amount" >= 0 AND "paid_out_amount" <= "amount"));

ALTER TABLE "refund_failures"
  ADD CONSTRAINT "refund_failures_amount_positive"
  CHECK ("amount" > 0);
