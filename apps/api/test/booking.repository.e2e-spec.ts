import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import {
  BookingRepository,
  GuestNotFoundError,
  ListingNotFoundError,
} from "./../src/booking/booking.repository";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { inDays } from "./dates";

/**
 * `bookings` has two foreign keys and Postgres reports both with the same Prisma code, so
 * which one gave way is read out of the constraint the driver adapter names. That is a
 * nested, adapter-specific shape rather than a documented field, and the branch is one
 * Prisma upgrade away from silently falling through to a 500 — hence a spec against the
 * real database rather than trust in the parse.
 *
 * The unit spec cannot reach it: it fakes the repository, so the translation from a driver
 * error into a domain one never runs there. Neither can the HTTP tests reach both halves —
 * the missing guest is provokable (delete the account behind a valid token), but the
 * missing listing is the losing side of a race with `listingExists`, so the API answers 404
 * from the pre-flight check long before the insert. Called directly, both are ordinary
 * arguments.
 */
describe("BookingRepository foreign keys (e2e)", () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let bookingRepository: BookingRepository;
  let guestId: string;
  let listingId: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prismaService = app.get(PrismaService);
    bookingRepository = app.get(BookingRepository);

    await resetDatabase(app);

    const guest = await prismaService.user.create({
      data: { email: "keys-guest@example.com", passwordHash: "hash" },
    });
    const owner = await prismaService.user.create({
      data: {
        email: "keys-owner@example.com",
        passwordHash: "hash",
        role: "OWNER",
      },
    });
    const listing = await prismaService.listing.create({
      data: {
        ownerId: owner.id,
        title: "Cabin by the lake",
        description: "Two rooms, a jetty and no neighbours.",
        pricePerNight: 12_000,
        capacity: 4,
      },
    });

    guestId = guest.id;
    listingId = listing.id;
  });

  afterEach(async () => {
    await app.close();
  });

  const dates = { from: inDays(30), to: inDays(34) };

  it("writes a booking when both rows are there", async () => {
    const booking = await bookingRepository.create(guestId, {
      listingId,
      ...dates,
    });

    expect(booking).toMatchObject({ guestId, listingId, ...dates });
  });

  // The branch the API cannot provoke: the listing was deleted between `listingExists` and
  // the insert. It has to stay a 404 about the listing rather than the 500 an unread
  // constraint would produce.
  it("names the listing when its key is the one that gave way", async () => {
    await expect(
      bookingRepository.create(guestId, { listingId: randomUUID(), ...dates }),
    ).rejects.toThrow(ListingNotFoundError);
  });

  // The other key, from the other side: nothing checks the guest before the insert, because
  // the token names it and JwtStrategy reads no database.
  it("names the guest when its key is the one that gave way", async () => {
    await expect(
      bookingRepository.create(randomUUID(), { listingId, ...dates }),
    ).rejects.toThrow(GuestNotFoundError);
  });

  // Both at once resolves to whichever key Postgres checks first, and the point is only
  // that it stays one of the two rather than falling through to the raw Prisma error.
  it("still names a key when neither row exists", async () => {
    await expect(
      bookingRepository.create(randomUUID(), {
        listingId: randomUUID(),
        ...dates,
      }),
    ).rejects.toThrow(/^(Listing|Guest) .* not found$/);
  });
});
