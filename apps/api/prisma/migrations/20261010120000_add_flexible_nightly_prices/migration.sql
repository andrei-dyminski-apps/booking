-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');

-- CreateTable
CREATE TABLE "listing_weekday_prices" (
    "listing_id" UUID NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "listing_weekday_prices_pkey" PRIMARY KEY ("listing_id","weekday")
);

-- CreateTable
CREATE TABLE "listing_date_prices" (
    "listing_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "listing_date_prices_pkey" PRIMARY KEY ("listing_id","date")
);

-- AddForeignKey
ALTER TABLE "listing_weekday_prices" ADD CONSTRAINT "listing_weekday_prices_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_date_prices" ADD CONSTRAINT "listing_date_prices_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The exceptions to a nightly price obey the ceiling the default does
-- (`listings_price_within_contract`), and for the same reason: the frontend parses
-- `GET /listings/:id` against `listingDetailSchema`, so a price above `MAX_PRICE` or at
-- zero written around the API -- the seed, an import, psql -- would take the listing's page
-- down rather than be refused where it was written. Nothing over HTTP reaches these: the
-- contract answers 400 first.
ALTER TABLE "listing_weekday_prices"
  ADD CONSTRAINT "listing_weekday_prices_price_within_contract"
  CHECK ("price" > 0 AND "price" <= 1000000);

ALTER TABLE "listing_date_prices"
  ADD CONSTRAINT "listing_date_prices_price_within_contract"
  CHECK ("price" > 0 AND "price" <= 1000000);
