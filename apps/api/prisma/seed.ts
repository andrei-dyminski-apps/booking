import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { PrismaClient, Role } from "../src/generated/prisma/client";

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

/** Prices are minor units, the way the column stores them: 12000 is 120.00 a night. */
const listings = [
  {
    title: "Loft above the harbour",
    description:
      "Two rooms under the roof, a wall of glass facing the water and a kitchen that fits four.",
    pricePerNight: 12000,
    capacity: 4,
  },
  {
    title: "Cottage at the edge of the pines",
    description:
      "A wood stove, a long table and nothing within earshot but the forest road.",
    pricePerNight: 8500,
    capacity: 6,
  },
  {
    title: "Studio on the market square",
    description:
      "One room, one window over the awnings, and every tram line within a minute's walk.",
    pricePerNight: 5400,
    capacity: 2,
  },
];

/**
 * Dates are relative to the day the seed runs, not written down: `createBookingSchema`
 * refuses a check-in in the past, and fixed dates would hand the demo data a shelf life
 * after which the API can no longer create what the seed just wrote.
 */
function inDays(days: number): Date {
  const date = new Date();

  date.setUTCDate(date.getUTCDate() + days);

  return new Date(date.toISOString().slice(0, 10));
}

/** Indexes into `listings`; the ids only exist once the rows are written. */
const bookings = [
  { listing: 0, from: inDays(10), to: inDays(14) },
  { listing: 0, from: inDays(19), to: inDays(21) },
  { listing: 1, from: inDays(12), to: inDays(16) },
  { listing: 2, from: inDays(40), to: inDays(53) },
];

async function main(): Promise<void> {
  // Order matters: bookings reference listings with onDelete: Restrict, and deleting the
  // users would otherwise cascade into listings the bookings still point at. Deleting the
  // users also takes their refresh tokens with them (onDelete: Cascade), so a re-seed ends
  // every session issued against the previous data.
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
