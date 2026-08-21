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

const bookings = [
  {
    roomId: "101",
    guestName: "Anna Fisher",
    from: new Date("2026-09-01"),
    to: new Date("2026-09-05"),
  },
  {
    roomId: "101",
    guestName: "Peter Walsh",
    from: new Date("2026-09-10"),
    to: new Date("2026-09-12"),
  },
  {
    roomId: "102",
    guestName: "Maria Bennett",
    from: new Date("2026-09-03"),
    to: new Date("2026-09-07"),
  },
  {
    roomId: "201",
    guestName: "John Carter",
    from: new Date("2026-10-01"),
    to: new Date("2026-10-14"),
  },
];

async function main(): Promise<void> {
  await prisma.booking.deleteMany();
  await prisma.booking.createMany({ data: bookings });

  // One hash for all three: argon2 is deliberately slow, and the demo password is the same.
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
  });

  // Deleting the users takes their refresh tokens with them (onDelete: Cascade), so a
  // re-seed also ends every session issued against the previous data.
  await prisma.user.deleteMany();
  await prisma.user.createMany({
    data: users.map((user) => ({ ...user, passwordHash })),
  });

  console.log(`Seeded bookings: ${bookings.length}`);
  console.log(
    `Seeded users: ${users.map((user) => user.email).join(", ")} — password "${DEMO_PASSWORD}"`,
  );
}

void main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
