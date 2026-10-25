import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import { BookingRepository } from "./../src/booking/infrastructure/booking.repository";
import {
  BookingExpiryQueue,
  EXPIRE_HOLD_JOB,
  SWEEP_LAPSED_HOLDS_JOB,
} from "./../src/booking/infrastructure/booking-expiry.queue";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { bookingExpiryQueue, resetQueue } from "./queue";
import { waitUntil } from "./wait-until";

/**
 * The proactive half of hold expiry, which the other specs cannot reach: they go through
 * the API, and no request releases a hold — a job does, fifteen minutes later. So this one
 * drives the queue directly and waits for the worker that `app.init()` started.
 *
 * Three things have to hold, and only a runner can provoke any of them: the per-hold job
 * flips exactly the row it names, the repeatable sweep flips the ones whose job was lost
 * on a listing nobody books again, and both are idempotent enough to arrive late — after
 * the guest has already cancelled, or after a previous run did the work.
 *
 * The deadlines are pushed into the past by hand rather than waited out. The sweep that
 * runs at boot is no help to these rows either: it happens before they exist, and the next
 * one is a minute away — longer than any test here lives.
 */
describe("Booking hold expiry (e2e)", () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let bookingRepository: BookingRepository;
  let expiryQueue: BookingExpiryQueue;
  let guestId: string;
  let ownerId: string;
  let listingId: string;

  const dates = { from: inDays(30), to: inDays(34) };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prismaService = app.get(PrismaService);
    bookingRepository = app.get(BookingRepository);
    expiryQueue = app.get(BookingExpiryQueue);

    await resetDatabase(app);
    await resetQueue(app);

    const guest = await prismaService.user.create({
      data: {
        name: "Expiry Guest",
        email: "expiry-guest@example.com",
        passwordHash: "hash",
      },
    });
    const owner = await prismaService.user.create({
      data: {
        name: "Expiry Owner",
        email: "expiry-owner@example.com",
        passwordHash: "hash",
      },
    });
    const listing = await prismaService.listing.create({
      data: {
        title: "Cabin by the lake",
        description: "One room, a stove and a jetty ten steps from the door.",
        pricePerNight: 80,
        capacity: 2,
        ownerId: owner.id,
      },
    });

    guestId = guest.id;
    ownerId = owner.id;
    listingId = listing.id;
  });

  afterEach(async () => {
    await app.close();
  });

  /** A hold whose fifteen minutes are already spent, without waiting fifteen minutes. */
  const lapsedHold = async (): Promise<string> => {
    const { booking } = await bookingRepository.create(guestId, {
      listingId,
      ...dates,
    });

    await prismaService.booking.update({
      where: { id: booking.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    return booking.id;
  };

  /** Who has been told this hold lapsed — the notice is written after the flip, by the worker. */
  const toldOfExpiry = async (bookingId: string): Promise<string[]> =>
    (
      await prismaService.notification.findMany({
        where: {
          type: "BOOKING_EXPIRED",
          data: { path: ["bookingId"], equals: bookingId },
        },
        orderBy: { userId: "asc" },
      })
    ).map((notice) => notice.userId);

  const statusOf = async (id: string): Promise<string> =>
    (await prismaService.booking.findUniqueOrThrow({ where: { id } })).status;

  it("releases the hold its own job names, and frees the slot with it", async () => {
    const id = await lapsedHold();

    await expiryQueue.scheduleExpiry(id, new Date(Date.now() - 1000));
    await waitUntil(async () => (await statusOf(id)) === "EXPIRED");

    // The deadline stays on the row: `status` is what says the slot was let go of, and
    // when it was let go of is what phase 5 will be asked about.
    const released = await prismaService.booking.findUniqueOrThrow({
      where: { id },
    });

    expect(released.expiresAt).not.toBeNull();

    // Both sides hear about it, once each.
    await waitUntil(async () => (await toldOfExpiry(id)).length === 2);
    expect(await toldOfExpiry(id)).toEqual([guestId, ownerId].sort());

    // The slot is free, which is the whole point of releasing a hold.
    await expect(
      bookingRepository.create(guestId, { listingId, ...dates }),
    ).resolves.toMatchObject({ booking: { status: "PENDING_PAYMENT" } });
  });

  it("sweeps a lapsed hold nobody comes back to", async () => {
    const id = await lapsedHold();

    // The lazy half inside `create` would never see this one — it only ever looks at the
    // listing being booked, and by assumption nobody books this listing again.
    await bookingExpiryQueue(app).add(SWEEP_LAPSED_HOLDS_JOB, {});
    await waitUntil(async () => (await statusOf(id)) === "EXPIRED");
    await waitUntil(async () => (await toldOfExpiry(id)).length === 2);
  });

  it("leaves a hold that still has time on it", async () => {
    const { booking } = await bookingRepository.create(guestId, {
      listingId,
      ...dates,
    });

    expect(await bookingRepository.expireLapsedHolds()).toEqual([]);
    expect(await statusOf(booking.id)).toBe("PENDING_PAYMENT");
  });

  /**
   * The job is scheduled when the hold is created and only best-effort cancelled when the
   * booking leaves `PENDING_PAYMENT`, so it has to be harmless whenever it lands: after a
   * cancellation, and a second time after it has already done its work.
   */
  it("is a no-op for a booking that is no longer a pending hold", async () => {
    const cancelled = await lapsedHold();
    await bookingRepository.cancel(cancelled, "PENDING_PAYMENT", null);

    await expect(bookingRepository.expireHold(cancelled)).resolves.toEqual([]);
    expect(await statusOf(cancelled)).toBe("CANCELLED");

    const expired = await lapsedHold();
    // Only the run that flipped the row hands it back, so only that one is told about.
    await expect(bookingRepository.expireHold(expired)).resolves.toHaveLength(
      1,
    );
    await expect(bookingRepository.expireHold(expired)).resolves.toEqual([]);
    expect(await statusOf(expired)).toBe("EXPIRED");
  });

  it("routes the two job names to the two updates", async () => {
    const id = await lapsedHold();

    // The per-hold job carries an id and the sweep carries nothing; the processor tells
    // them apart by name, so a job of the wrong name would silently do the other thing.
    await bookingExpiryQueue(app).add(EXPIRE_HOLD_JOB, { bookingId: id });
    await waitUntil(async () => (await statusOf(id)) === "EXPIRED");
  });
});
