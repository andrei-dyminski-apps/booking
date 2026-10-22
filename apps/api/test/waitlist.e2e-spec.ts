import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { App } from "supertest/types";
import {
  NotificationType,
  Role,
  bookingSchema,
  notificationPageSchema,
  waitlistDemandPageSchema,
  waitlistEntrySchema,
  waitlistSchema,
  type CreateBookingInput,
  type Notification,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { BookingService } from "./../src/booking/booking.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { resetQueue } from "./queue";
import { hostCredentials, signIn, signInAs, type Agent } from "./session";

describe("WaitlistController (e2e)", () => {
  let app: INestApplication<App>;
  let holder: Agent;
  let waiter: Agent;
  let owner: Agent;
  let admin: Agent;
  let stay: CreateBookingInput;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    await resetDatabase(app);
    await resetQueue(app);

    holder = await signInAs(app, Role.USER);
    waiter = await signInAs(app, Role.USER, {
      name: "E2E Waiter",
      email: "e2e-waiter@example.com",
      password: "password123",
    });
    owner = await signIn(app, hostCredentials);
    admin = await signInAs(app, Role.ADMIN);

    const listing = await owner
      .post("/listings")
      .send({
        title: "Loft above the harbour",
        description: "Two rooms under the roof and a wall of glass.",
        pricePerNight: 120,
        capacity: 4,
      })
      .expect(201);

    stay = {
      listingId: (listing.body as { id: string }).id,
      from: inDays(10),
      to: inDays(14),
    };
  });

  afterEach(async () => {
    await app.close();
  });

  /** The holder takes the nights; the answer is the booking that now blocks them. */
  const hold = async (): Promise<string> =>
    bookingSchema.parse(
      (await holder.post("/bookings").send(stay).expect(201)).body,
    ).id;

  const noticesOf = async (agent: Agent): Promise<Notification[]> =>
    notificationPageSchema.parse(
      (await agent.get("/notifications").expect(200)).body,
    ).items;

  const waitingFor = (agent: Agent) =>
    agent
      .get("/waitlist")
      .expect(200)
      .then((response) => waitlistSchema.parse(response.body));

  it("lets a user wait for held nights, once however often they join", async () => {
    await hold();

    const first = waitlistEntrySchema.parse(
      (await waiter.post("/waitlist").send(stay).expect(201)).body,
    );
    const again = waitlistEntrySchema.parse(
      (await waiter.post("/waitlist").send(stay).expect(201)).body,
    );

    expect(again.id).toBe(first.id);
    await expect(waitingFor(waiter)).resolves.toEqual([first]);
  });

  it("refuses free nights, the owner's own listing and an admin", async () => {
    await waiter.post("/waitlist").send(stay).expect(409);

    await hold();

    await owner.post("/waitlist").send(stay).expect(403);
    await admin.post("/waitlist").send(stay).expect(403);
  });

  it("tells the waiter when the holder cancels, and takes the entry off the list", async () => {
    const bookingId = await hold();

    await waiter.post("/waitlist").send(stay).expect(201);
    await holder.delete(`/bookings/${bookingId}`).expect(204);

    const [notice] = await noticesOf(waiter);

    expect(notice).toMatchObject({
      type: NotificationType.WAITLIST_AVAILABLE,
      data: { listingId: stay.listingId, from: stay.from, to: stay.to },
    });
    await expect(waitingFor(waiter)).resolves.toEqual([]);

    // The nights are free, so the waiter can take them — through the same route as anybody.
    await waiter.post("/bookings").send(stay).expect(201);
  });

  it("tells the waiter when a hold lapses unpaid", async () => {
    const bookingId = await hold();

    await waiter.post("/waitlist").send(stay).expect(201);
    await app.get(PrismaService).booking.update({
      where: { id: bookingId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await app.get(BookingService).releaseHold(bookingId);

    expect((await noticesOf(waiter)).map(({ type }) => type)).toEqual([
      NotificationType.WAITLIST_AVAILABLE,
    ]);
  });

  it("tells nobody while part of the range is still held by somebody else", async () => {
    const first = await hold();

    // A second stay right after the first, by the same holder.
    await holder
      .post("/bookings")
      .send({ ...stay, from: stay.to, to: inDays(16) })
      .expect(201);
    await waiter
      .post("/waitlist")
      .send({ ...stay, to: inDays(16) })
      .expect(201);

    await holder.delete(`/bookings/${first}`).expect(204);

    await expect(noticesOf(waiter)).resolves.toEqual([]);
    await expect(waitingFor(waiter)).resolves.toHaveLength(1);
  });

  it("refuses a range only the caller's own stay holds", async () => {
    await hold();

    await holder.post("/waitlist").send(stay).expect(403);
  });

  it("tells nobody whose check-in has already passed", async () => {
    const bookingId = await hold();
    const { id: userId } = (await waiter.get("/auth/me").expect(200)).body as {
      id: string;
    };

    // No request can join for a past check-in, so the entry is written as if it had been
    // joined days ago and its first night has gone by since.
    await app.get(PrismaService).waitlistEntry.create({
      data: {
        listingId: stay.listingId,
        userId,
        from: new Date(inDays(-1)),
        to: new Date(inDays(12)),
      },
    });
    await holder.delete(`/bookings/${bookingId}`).expect(204);

    await expect(noticesOf(waiter)).resolves.toEqual([]);
  });

  it("lets a waiter leave, and answers 404 for an entry that is not theirs", async () => {
    await hold();

    const entry = waitlistEntrySchema.parse(
      (await waiter.post("/waitlist").send(stay).expect(201)).body,
    );

    await holder.delete(`/waitlist/${entry.id}`).expect(404);
    await waiter.delete(`/waitlist/${entry.id}`).expect(204);
    await expect(waitingFor(waiter)).resolves.toEqual([]);
  });

  it("shows the host who waits on their listing as a range, and the admin as a person", async () => {
    await hold();
    await waiter.post("/waitlist").send(stay).expect(201);

    const hosting = waitlistDemandPageSchema.parse(
      (await owner.get("/waitlist/demand").expect(200)).body,
    );
    const everyone = waitlistDemandPageSchema.parse(
      (await admin.get("/waitlist/demand").expect(200)).body,
    );
    const elsewhere = waitlistDemandPageSchema.parse(
      (await holder.get("/waitlist/demand").expect(200)).body,
    );

    expect(hosting.items).toMatchObject([
      { listingId: stay.listingId, from: stay.from, waiter: null },
    ]);
    expect(everyone.items).toMatchObject([
      { listingId: stay.listingId, waiter: { name: "E2E Waiter" } },
    ]);
    expect(elsewhere.items).toEqual([]);
  });

  it("pages the demand with a cursor it refuses under another ordering", async () => {
    await hold();
    await waiter.post("/waitlist").send(stay).expect(201);
    await waiter
      .post("/waitlist")
      .send({ ...stay, from: inDays(11), to: inDays(13) })
      .expect(201);

    const first = waitlistDemandPageSchema.parse(
      (await admin.get("/waitlist/demand?limit=1").expect(200)).body,
    );
    const cursor = first.nextCursor ?? "";
    const second = waitlistDemandPageSchema.parse(
      (
        await admin
          .get(`/waitlist/demand?limit=1&cursor=${encodeURIComponent(cursor)}`)
          .expect(200)
      ).body,
    );

    expect(first.items[0]?.from).toBe(stay.from);
    expect(second.items[0]?.from).toBe(inDays(11));
    expect(second.nextCursor).toBeNull();
    await admin
      .get(`/waitlist/demand?sort=newest&cursor=${encodeURIComponent(cursor)}`)
      .expect(400);
  });
});
