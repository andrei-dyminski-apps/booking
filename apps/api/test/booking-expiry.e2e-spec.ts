import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import { BookingRepository } from "./../src/booking/booking.repository";
import {
  BookingExpiryQueue,
  EXPIRE_HOLD_JOB,
  SWEEP_LAPSED_HOLDS_JOB,
} from "./../src/booking/booking-expiry.queue";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { bookingExpiryQueue, resetQueue } from "./queue";

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
        role: "OWNER",
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
    listingId = listing.id;
  });

  afterEach(async () => {
    await app.close();
  });

  /** A hold whose fifteen minutes are already spent, without waiting fifteen minutes. */
  const lapsedHold = async (): Promise<string> => {
    const booking = await bookingRepository.create(guestId, {
      listingId,
      ...dates,
    });

    await prismaService.booking.update({
      where: { id: booking.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    return booking.id;
  };

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

    // The slot is free, which is the whole point of releasing a hold.
    await expect(
      bookingRepository.create(guestId, { listingId, ...dates }),
    ).resolves.toMatchObject({ status: "PENDING_PAYMENT" });
  });

  it("sweeps a lapsed hold nobody comes back to", async () => {
    const id = await lapsedHold();

    // The lazy half inside `create` would never see this one — it only ever looks at the
    // listing being booked, and by assumption nobody books this listing again.
    await bookingExpiryQueue(app).add(SWEEP_LAPSED_HOLDS_JOB, {});
    await waitUntil(async () => (await statusOf(id)) === "EXPIRED");
  });

  it("leaves a hold that still has time on it", async () => {
    const booking = await bookingRepository.create(guestId, {
      listingId,
      ...dates,
    });

    expect(await bookingRepository.expireLapsedHolds()).toBe(0);
    expect(await statusOf(booking.id)).toBe("PENDING_PAYMENT");
  });

  /**
   * The job is scheduled when the hold is created and only best-effort cancelled when the
   * booking leaves `PENDING_PAYMENT`, so it has to be harmless whenever it lands: after a
   * cancellation, and a second time after it has already done its work.
   */
  it("is a no-op for a booking that is no longer a pending hold", async () => {
    const cancelled = await lapsedHold();
    await bookingRepository.cancel(cancelled);

    await bookingRepository.expireHold(cancelled);
    expect(await statusOf(cancelled)).toBe("CANCELLED");

    const expired = await lapsedHold();
    await bookingRepository.expireHold(expired);
    await bookingRepository.expireHold(expired);
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

/** Polls rather than sleeps: what is being waited for is a worker in another loop. */
async function waitUntil(
  condition: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) return;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Condition was not met within ${String(timeoutMs)}ms`);
}
