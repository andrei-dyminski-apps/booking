import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import {
  BookingRepository,
  DatesUnavailableError,
  GuestNotFoundError,
  ListingNotFoundError,
} from "./../src/booking/infrastructure/booking.repository";
import { PrismaService } from "./../src/prisma/prisma.service";
import { HOLD_TTL_MS } from "./../src/booking/domain/booking-status";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { resetQueue } from "./queue";

/**
 * Two adapter-specific error shapes this layer has to keep reading correctly, and both are
 * a nested, undocumented path one Prisma upgrade away from falling through to a 500 —
 * hence a spec against the real database rather than trust in the parse:
 *
 *  - a foreign key violation on the guest key (`23503` → which key, read out of the
 *    constraint the driver names);
 *  - an `EXCLUDE` constraint violation (`23P01`) when two overlapping active stays race
 *    past the in-transaction overlap check.
 *
 * The unit spec cannot reach either: it fakes the repository, so no driver error is ever
 * translated. The HTTP tests reach the guest key (delete the account behind a valid token)
 * but not the listing key — a missing listing is now refused by the `FOR UPDATE` read
 * before any insert. Called directly, these are ordinary arguments.
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
    await resetQueue(app);

    const guest = await prismaService.user.create({
      data: {
        name: "Keys Guest",
        email: "keys-guest@example.com",
        passwordHash: "hash",
      },
    });
    const owner = await prismaService.user.create({
      data: {
        name: "Keys Owner",
        email: "keys-owner@example.com",
        passwordHash: "hash",
      },
    });
    const listing = await prismaService.listing.create({
      data: {
        ownerId: owner.id,
        title: "Cabin by the lake",
        description: "Two rooms, a jetty and no neighbours.",
        pricePerNight: 120,
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

  it("writes a booking as a pending hold when both rows are there", async () => {
    const { booking } = await bookingRepository.create(guestId, {
      listingId,
      ...dates,
    });

    expect(booking).toMatchObject({
      guestId,
      listingId,
      ...dates,
      status: "PENDING_PAYMENT",
    });
    // The deadline is the payment window, not merely some moment: this is the one place
    // that decides it, so this is where the fifteen minutes are asserted.
    expect(
      Date.parse(String(booking.expiresAt)) - Date.parse(booking.createdAt),
    ).toBeCloseTo(HOLD_TTL_MS, -3);
  });

  // A missing listing is now refused by the `FOR UPDATE` read at the top of the
  // transaction, before any insert — but it still has to be a `ListingNotFoundError`.
  it("names the listing when it is missing under the lock", async () => {
    await expect(
      bookingRepository.create(guestId, { listingId: randomUUID(), ...dates }),
    ).rejects.toThrow(ListingNotFoundError);
  });

  // The overlap the in-transaction check catches — the informative path.
  it("refuses an overlapping range with DatesUnavailableError", async () => {
    await bookingRepository.create(guestId, { listingId, ...dates });

    await expect(
      bookingRepository.create(guestId, {
        listingId,
        from: inDays(32),
        to: inDays(36),
      }),
    ).rejects.toThrow(DatesUnavailableError);
  });

  // Racing past that check lands on the EXCLUDE constraint (`23P01`); the point is that it
  // still resolves to the domain error rather than a raw Prisma one.
  it("refuses a racing overlap with the same domain error", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        bookingRepository.create(guestId, { listingId, ...dates }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(DatesUnavailableError);
    }
  });

  // The other key, from the other side: nothing checks the guest before the insert, because
  // the token names it and JwtStrategy reads no database.
  it("names the guest when its key is the one that gave way", async () => {
    await expect(
      bookingRepository.create(randomUUID(), { listingId, ...dates }),
    ).rejects.toThrow(GuestNotFoundError);
  });

  /**
   * `lapsedHolds` and `holdsTheSlot` are written around `expires_at`, and under SQL's
   * three-valued logic a `PENDING_PAYMENT` row without one makes both of them NULL: a hold
   * no read of this repository can see, that no sweep can ever release, and that the
   * `EXCLUDE` constraint — which filters on the status alone — goes on counting. The
   * catalogue would offer nights `POST /bookings` then refuses, permanently.
   *
   * Nothing in this codebase writes such a row, which is exactly why the assumption is
   * worth pinning to the database rather than to a reading of `create`. The insert is
   * therefore raw: through the repository the case is unreachable by construction.
   */
  it("refuses a hold with no deadline at all", async () => {
    await expect(
      prismaService.$executeRaw`
        INSERT INTO bookings (id, listing_id, guest_id, from_date, to_date, status, expires_at, amount)
        VALUES (gen_random_uuid(), ${listingId}::uuid, ${guestId}::uuid,
                ${dates.from}::date, ${dates.to}::date, 'PENDING_PAYMENT', NULL, 480)
      `,
    ).rejects.toThrow(/bookings_hold_has_deadline/);

    // The statuses that no longer hold by a deadline keep the right to have none — which
    // is what the seed writes.
    await expect(
      prismaService.$executeRaw`
        INSERT INTO bookings (id, listing_id, guest_id, from_date, to_date, status, expires_at, amount)
        VALUES (gen_random_uuid(), ${listingId}::uuid, ${guestId}::uuid,
                ${dates.from}::date, ${dates.to}::date, 'CONFIRMED', NULL, 480)
      `,
    ).resolves.toBe(1);
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
