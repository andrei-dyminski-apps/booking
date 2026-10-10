import { TZDate } from "@date-fns/tz";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { addDays, format } from "date-fns";
import {
  BookingStatus,
  PrismaClient,
  Role,
  Weekday,
} from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/** Every demo login shares it. Documented in the README — they exist only in this seed. */
const DEMO_PASSWORD = "password123";

/**
 * One login per role, plus the accounts that give the filter boxes something to suggest:
 * a second host, so the admin's owner filter has a choice, and three more guests, two of
 * them with the same name — what the address beside a name exists to tell apart for an
 * admin, and what a host sees only by the id.
 */
const users = {
  guest: {
    name: "Maya Lindqvist",
    email: "guest@example.com",
    role: Role.USER,
  },
  owner: { name: "Tomas Berg", email: "owner@example.com", role: Role.OWNER },
  admin: { name: "Nora Hale", email: "admin@example.com", role: Role.ADMIN },
  host: { name: "Ines Duarte", email: "ines@example.com", role: Role.OWNER },
  alex: {
    name: "Alex Morgan",
    email: "alex.morgan@example.com",
    role: Role.USER,
  },
  otherAlex: {
    name: "Alex Morgan",
    email: "amorgan@example.com",
    role: Role.USER,
  },
  sam: { name: "Sam Ortega", email: "sam@example.com", role: Role.USER },
} satisfies Record<string, { name: string; email: string; role: Role }>;

type UserKey = keyof typeof users;

/**
 * Prices are the currency itself, to the cent: 120 is a hundred and twenty a night. The
 * owner holds most of the catalogue and the second host the last two listings.
 *
 * `pricePerNight` is the default; a few listings carry the exceptions as well — dearer
 * weekends, a cheaper midweek, a few dates priced on their own — so the listing page has
 * a stay whose nights do not all cost the same to quote. The dates are days from the run,
 * for the reason `inDays` below gives.
 */
const listings: Array<{
  owner: UserKey;
  title: string;
  description: string;
  pricePerNight: number;
  capacity: number;
  weekdayPrices?: Partial<Record<Weekday, number>>;
  datePrices?: Array<{ inDays: number; price: number }>;
}> = [
  {
    owner: "owner",
    title: "Loft above the harbour",
    description:
      "Two rooms under the roof, a wall of glass facing the water and a kitchen that fits four.",
    pricePerNight: 120,
    capacity: 4,
    weekdayPrices: { fri: 150, sat: 150 },
    datePrices: [
      { inDays: 30, price: 199 },
      { inDays: 31, price: 199 },
    ],
  },
  {
    owner: "owner",
    title: "Cottage at the edge of the pines",
    description:
      "A wood stove, a long table and nothing within earshot but the forest road.",
    pricePerNight: 85,
    capacity: 6,
    weekdayPrices: { mon: 70, tue: 70, wed: 70, thu: 70 },
  },
  {
    owner: "owner",
    title: "Studio on the market square",
    description:
      "One room, one window over the awnings, and every tram line within a minute's walk.",
    pricePerNight: 54,
    capacity: 2,
  },
  {
    owner: "owner",
    title: "Farmhouse with the long table",
    description:
      "Six bedrooms, a kitchen built for a crowd and a field that ends at the river.",
    pricePerNight: 210,
    capacity: 12,
  },
  {
    owner: "owner",
    title: "Attic room off the canal",
    description:
      "A bed under the beams, a desk at the window and the water two floors down.",
    pricePerNight: 39,
    capacity: 1,
  },
  {
    owner: "owner",
    title: "Beach house on stilts",
    description:
      "A deck facing west, an outdoor shower and sand from the bottom step onwards.",
    pricePerNight: 165,
    capacity: 8,
    weekdayPrices: { sat: 195, sun: 195 },
    datePrices: [{ inDays: 45, price: 250 }],
  },
  {
    owner: "host",
    title: "Vineyard cottage",
    description:
      "Two rooms at the end of a row of vines, with the press house for a neighbour.",
    pricePerNight: 98,
    capacity: 3,
  },
  {
    owner: "host",
    title: "Cabin at the tree line",
    description:
      "A stove, a drying rack for boots and the last road before the path takes over.",
    pricePerNight: 72,
    capacity: 4,
  },
];

/**
 * Dates are relative to the day the seed runs, not written down: `createBookingSchema`
 * refuses a check-in in the past, and fixed dates would hand the demo data a shelf life
 * after which the API can no longer create what the seed just wrote.
 */
function inDays(days: number): Date {
  return TZDate.tz(
    "UTC",
    format(addDays(TZDate.tz("UTC"), days), "yyyy-MM-dd"),
  );
}

/**
 * Indexes into `listings`; the ids only exist once the rows are written. Several listings
 * are left with no stay at all on purpose: the catalogue's date filter has to have
 * something to keep as well as something to drop. The stays of one listing never overlap
 * — `bookings_no_overlap` would refuse the seed.
 */
const bookings: Array<{
  guest: UserKey;
  listing: number;
  from: Date;
  to: Date;
}> = [
  { guest: "guest", listing: 0, from: inDays(10), to: inDays(14) },
  { guest: "guest", listing: 0, from: inDays(19), to: inDays(21) },
  { guest: "guest", listing: 1, from: inDays(12), to: inDays(16) },
  { guest: "guest", listing: 2, from: inDays(40), to: inDays(53) },
  { guest: "guest", listing: 3, from: inDays(5), to: inDays(9) },
  { guest: "guest", listing: 6, from: inDays(30), to: inDays(37) },
  { guest: "alex", listing: 1, from: inDays(20), to: inDays(23) },
  { guest: "otherAlex", listing: 2, from: inDays(8), to: inDays(11) },
  { guest: "sam", listing: 3, from: inDays(15), to: inDays(18) },
  { guest: "sam", listing: 7, from: inDays(25), to: inDays(28) },
];

async function main(): Promise<void> {
  // Order matters, and both steps are refusals rather than cascades: bookings reference
  // listings with onDelete: Restrict, and listings reference their owner the same way, so
  // deleting the users first fails on the foreign key instead of taking the rows with it.
  // Deleting the users does take their refresh tokens (onDelete: Cascade), so a re-seed
  // ends every session issued against the previous data.
  await prisma.booking.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.user.deleteMany();

  // One hash for every account: argon2 is deliberately slow, and the demo password is the same.
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
  });

  const created = await Promise.all(
    Object.values(users).map((user) =>
      prisma.user.create({ data: { ...user, passwordHash } }),
    ),
  );

  // Found by the address, the one unique column a demo account is written with.
  const idOf = (key: UserKey): string => {
    const row = created.find((user) => user.email === users[key].email);

    if (row === undefined) {
      throw new Error(`The demo account "${key}" was not written`);
    }

    return row.id;
  };

  const rooms = await Promise.all(
    listings.map(({ owner, weekdayPrices = {}, datePrices = [], ...listing }) =>
      prisma.listing.create({
        data: {
          ...listing,
          ownerId: idOf(owner),
          weekdayPrices: {
            create: Object.values(Weekday).flatMap((weekday) => {
              const price = weekdayPrices[weekday];

              return price === undefined ? [] : [{ weekday, price }];
            }),
          },
          datePrices: {
            create: datePrices.map((entry) => ({
              date: inDays(entry.inDays),
              price: entry.price,
            })),
          },
        },
      }),
    ),
  );

  await prisma.booking.createMany({
    data: bookings.map((booking) => {
      const listing = rooms[booking.listing];

      if (listing === undefined) {
        throw new Error(`No demo listing at index ${booking.listing}`);
      }

      return {
        listingId: listing.id,
        guestId: idOf(booking.guest),
        from: booking.from,
        to: booking.to,
        // Confirmed, not holds: a PENDING_PAYMENT booking would lapse 15 minutes after
        // the seed runs and disappear from the demo.
        status: BookingStatus.CONFIRMED,
      };
    }),
  });

  console.log(
    `Seeded users: ${Object.values(users)
      .map((user) => `${user.name} <${user.email}>`)
      .join(", ")} — password "${DEMO_PASSWORD}"`,
  );
  console.log(
    `Seeded listings: ${listings.length}, bookings: ${bookings.length}`,
  );
}

void main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
