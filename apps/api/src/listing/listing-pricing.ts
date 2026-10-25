import { tz } from "@date-fns/tz";
import { parseISO } from "date-fns";
import type { ListingPricing, PricedListing } from "@repo/contracts";
import type {
  Prisma,
  ListingDatePrice as DatePriceRow,
  ListingWeekdayPrice as WeekdayPriceRow,
} from "../generated/prisma/client";
import { toIsoDate } from "../common/iso-date";

/**
 * The exception rows onto the contract. The `Decimal` becomes a `number` here for the
 * reason `toListing` gives, and the date is cut back to its day the way `BookingRepository`
 * cuts a stay's.
 *
 * It lives beside `ListingRepository` rather than inside it because a second reader needs
 * it: the transaction that takes a hold quotes the stay off these rows, and a row mapping
 * does not cross between two repositories — the price tables are the listing's, so the
 * function that reads them is too. A file of its own also keeps the two repositories from
 * importing each other, which they would otherwise do in both directions.
 */
export function toPricing(
  weekdayRows: WeekdayPriceRow[],
  dateRows: DatePriceRow[],
): ListingPricing {
  return {
    weekdays: Object.fromEntries(
      weekdayRows.map((row) => [row.weekday, row.price.toNumber()]),
    ),
    dates: dateRows.map((row) => ({
      date: toIsoDate(row.date),
      price: row.price.toNumber(),
    })),
  };
}

/**
 * What a stay on this listing is quoted from, read inside the caller's transaction: the
 * default price and every exception that can apply to its nights — the weekday prices and
 * the date prices from check-in up to check-out. `null` for a row that is not there.
 *
 * The caller is `BookingRepository.create`, after its `FOR UPDATE` on the listing row. A
 * save of the prices writes that row first (`ListingRepository.update`), so it queues
 * behind the lock, and the quote cannot read half of a save that is replacing the set.
 */
export async function readPricedListing(
  tx: Prisma.TransactionClient,
  listingId: string,
  stay: { from: string; to: string },
): Promise<PricedListing | null> {
  const row = await tx.listing.findUnique({
    where: { id: listingId },
    select: {
      pricePerNight: true,
      weekdayPrices: true,
      datePrices: {
        where: {
          date: {
            gte: new Date(parseISO(stay.from, { in: tz("UTC") }).getTime()),
            lt: new Date(parseISO(stay.to, { in: tz("UTC") }).getTime()),
          },
        },
      },
    },
  });

  return row === null
    ? null
    : {
        pricePerNight: row.pricePerNight.toNumber(),
        pricing: toPricing(row.weekdayPrices, row.datePrices),
      };
}
