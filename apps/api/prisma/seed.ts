import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

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
  console.log(`Seeded bookings: ${bookings.length}`);
}

void main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
