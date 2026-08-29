import { TZDate } from "@date-fns/tz";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { addDays, format } from "date-fns";
import {
  BookingStatus,
  PrismaClient,
  Role,
} from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/** Demo logins, one per role. Documented in the README — they exist only in this seed. */
const DEMO_PASSWORD = "password123";

const users = [
  { email: "guest@example.com", role: Role.USER },
  { email: "owner@example.com", role: Role.OWNER },
  { email: "admin@example.com", role: Role.ADMIN },
];

/** Prices are the currency itself, to the cent: 120 is a hundred and twenty a night. */
const listings = [
  {
    title: "Loft above the harbour",
    description:
      "Two rooms under the roof, a wall of glass facing the water and a kitchen that fits four.",
    pricePerNight: 120,
    capacity: 4,
  },
  {
    title: "Cottage at the edge of the pines",
    description:
      "A wood stove, a long table and nothing within earshot but the forest road.",
    pricePerNight: 85,
    capacity: 6,
  },
  {
    title: "Studio on the market square",
    description:
      "One room, one window over the awnings, and every tram line within a minute's walk.",
    pricePerNight: 54,
    capacity: 2,
  },
  {
    title: "Farmhouse with the long table",
    description:
      "Six bedrooms, a kitchen built for a crowd and a field that ends at the river.",
    pricePerNight: 210,
    capacity: 12,
  },
  {
    title: "Attic room off the canal",
    description:
      "A bed under the beams, a desk at the window and the water two floors down.",
    pricePerNight: 39,
    capacity: 1,
  },
  {
    title: "Beach house on stilts",
    description:
      "A deck facing west, an outdoor shower and sand from the bottom step onwards.",
    pricePerNight: 165,
    capacity: 8,
  },
  {
    title: "Vineyard cottage",
    description:
      "Two rooms at the end of a row of vines, with the press house for a neighbour.",
    pricePerNight: 98,
    capacity: 3,
  },
  {
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
 * something to keep as well as something to drop.
 */
const bookings = [
  { listing: 0, from: inDays(10), to: inDays(14) },
  { listing: 0, from: inDays(19), to: inDays(21) },
  { listing: 1, from: inDays(12), to: inDays(16) },
  { listing: 2, from: inDays(40), to: inDays(53) },
  { listing: 3, from: inDays(5), to: inDays(9) },
  { listing: 6, from: inDays(30), to: inDays(37) },
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

  // One hash for all three: argon2 is deliberately slow, and the demo password is the same.
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
  });

  const created = await Promise.all(
    users.map((user) =>
      prisma.user.create({ data: { ...user, passwordHash } }),
    ),
  );

  const owner = created.find((user) => user.role === Role.OWNER);
  const guest = created.find((user) => user.role === Role.USER);

  if (owner === undefined || guest === undefined) {
    throw new Error("The demo users must include an owner and a guest");
  }

  const rooms = await Promise.all(
    listings.map((listing) =>
      prisma.listing.create({ data: { ...listing, ownerId: owner.id } }),
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
        guestId: guest.id,
        from: booking.from,
        to: booking.to,
        // Confirmed, not holds: a PENDING_PAYMENT booking would lapse 15 minutes after
        // the seed runs and disappear from the demo.
        status: BookingStatus.CONFIRMED,
      };
    }),
  });

  console.log(
    `Seeded users: ${users.map((user) => user.email).join(", ")} — password "${DEMO_PASSWORD}"`,
  );
  console.log(
    `Seeded listings: ${listings.length} owned by ${owner.email}, bookings: ${bookings.length} taken by ${guest.email}`,
  );
}

void main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
