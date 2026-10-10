import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { App } from "supertest/types";
import {
  Role,
  apiErrorSchema,
  bookingPageSchema,
  bookingSchema,
  type Booking,
  type BookingPage,
  type CreateBookingInput,
  type CreateListingInput,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { HOLD_TTL_MS } from "./../src/booking/domain/booking-status";
import { resetQueue } from "./queue";
import { credentialsFor, signInAs, type Agent } from "./session";

const listingInput: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNight: 120,
  capacity: 4,
};

describe("BookingController (e2e)", () => {
  let app: INestApplication<App>;
  // Every booking route sits behind the global JwtAuthGuard, so the spec talks to the API
  // through signed-in agents rather than bare requests — one per role, because what a
  // booking route answers now depends on who is asking.
  let guest: Agent;
  let otherGuest: Agent;
  let owner: Agent;
  let admin: Agent;

  let input: CreateBookingInput;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Tests hit the real database and Redis from docker-compose — reset both.
    await resetDatabase(app);
    await resetQueue(app);

    guest = await signInAs(app, Role.USER);
    otherGuest = await signInAs(app, Role.USER, {
      name: "E2E Second Guest",
      email: "e2e-guest-2@example.com",
      password: "password123",
    });
    owner = await signInAs(app, Role.OWNER);
    admin = await signInAs(app, Role.ADMIN);

    const listing = await owner
      .post("/listings")
      .send(listingInput)
      .expect(201);

    input = {
      listingId: (listing.body as { id: string }).id,
      from: inDays(10),
      to: inDays(14),
    };
  });

  afterEach(async () => {
    await app.close();
  });

  /** One page of `GET /bookings`, parsed against the contract like every other answer. */
  const page = async (
    agent: Agent,
    search: Record<string, string> = {},
  ): Promise<BookingPage> =>
    bookingPageSchema.parse(
      (await agent.get("/bookings").query(search).expect(200)).body,
    );

  /** The rows of that page, for the assertions that are about the scope or the filters. */
  const stays = async (
    agent: Agent,
    search: Record<string, string> = {},
  ): Promise<Booking[]> => (await page(agent, search)).items;

  it("creates a booking and answers with a body matching the contract schema", async () => {
    const response = await guest.post("/bookings").send(input).expect(201);
    const booking = bookingSchema.parse(response.body);
    const session = await guest.get("/auth/me").expect(200);

    // The guest is the session, not a field of the request.
    expect(booking.guestId).toBe((session.body as { id: string }).id);
    // A fresh booking is a hold, and the deadline is the payment window rather than any
    // non-null moment: HOLD_TTL_MS after the row was written. A second of tolerance,
    // because the two timestamps are taken by different statements.
    expect(booking.status).toBe("PENDING_PAYMENT");
    expect(
      Date.parse(String(booking.expiresAt)) - Date.parse(booking.createdAt),
    ).toBeCloseTo(HOLD_TTL_MS, -3);
  });

  /**
   * The one thing on the API surface that resolves a retired listing, and the reason the
   * booking carries a summary of it at all: the row is kept so a stay can go on naming
   * where it was, while `GET /listings/:id` answers 404 for it — to the guest holding the
   * booking as much as to anybody else, because that read is public and cached by URL.
   */
  it("goes on naming the listing after it has been retired", async () => {
    const created = await guest.post("/bookings").send(input).expect(201);
    const id = (created.body as { id: string }).id;

    expect(bookingSchema.parse(created.body).listing).toEqual({
      title: listingInput.title,
      pricePerNight: listingInput.pricePerNight,
    });

    await owner.delete(`/listings/${input.listingId}`).expect(204);
    await guest.get(`/listings/${input.listingId}`).expect(404);

    const stay = await guest.get(`/bookings/${id}`).expect(200);

    expect(bookingSchema.parse(stay.body).listing.title).toBe(
      listingInput.title,
    );
  });

  it("books for guests only — an owner rents out, an admin moderates", async () => {
    for (const agent of [owner, admin]) {
      await agent.post("/bookings").send(input).expect(403);
    }
  });

  it("rejects a body that does not pass the schema", async () => {
    const response = await guest
      .post("/bookings")
      .send({ ...input, listingId: "not-a-uuid" })
      .expect(400);

    // The error body is part of the contract too: the frontend puts these issues
    // under the matching inputs, so their shape has to be checked, not just the status.
    const error = apiErrorSchema.parse(response.body);

    expect(error.errors).toEqual([
      expect.objectContaining({ path: ["listingId"] }),
    ]);
  });

  it("rejects check-out before check-in — the rule lives in the schema", async () => {
    await guest
      .post("/bookings")
      .send({ ...input, from: inDays(14), to: inDays(10) })
      .expect(400);
  });

  it("rejects a check-in in the past — the rule lives in the schema", async () => {
    const response = await guest
      .post("/bookings")
      .send({ ...input, from: inDays(-1), to: inDays(3) })
      .expect(400);

    expect(apiErrorSchema.parse(response.body).errors).toEqual([
      expect.objectContaining({ path: ["from"] }),
    ]);
  });

  it("answers 404 for a listing that does not exist", async () => {
    await guest
      .post("/bookings")
      .send({ ...input, listingId: "8c9d0e1f-2a3b-4c5d-9e6f-7a8b9c0d1e2f" })
      .expect(404);
  });

  /**
   * The one foreign key nothing checks before the insert: the guest is whoever the access
   * token names, and JwtStrategy reads no database, so a deleted account keeps making
   * valid-looking requests until the token expires. The two keys of `bookings` fail with
   * the same Prisma code, and this is what tells them apart — the listing is there.
   */
  it("answers 401 when the account behind the token was deleted mid-session", async () => {
    await app
      .get(PrismaService)
      .user.delete({ where: { email: credentialsFor[Role.USER].email } });

    const response = await guest.post("/bookings").send(input).expect(401);

    expect(apiErrorSchema.parse(response.body).message).toBe(
      "Session no longer exists",
    );
  });

  it("answers 409 when the dates overlap an existing booking", async () => {
    await guest.post("/bookings").send(input).expect(201);

    const response = await otherGuest
      .post("/bookings")
      .send({ ...input, from: inDays(13), to: inDays(17) })
      .expect(409);

    // A Nest exception carries a message and no per-field issues — the same contract.
    const error = apiErrorSchema.parse(response.body);

    expect(error.errors).toBeUndefined();
    expect(error.message).toContain(input.listingId);
  });

  // The overlap is a pair of strict inequalities, and this is what says so now that the
  // query itself lives in BookingRepository: check-out is the morning the room is free.
  it("lets a stay start on the day another one ends", async () => {
    await guest.post("/bookings").send(input).expect(201);

    await otherGuest
      .post("/bookings")
      .send({ ...input, from: input.to, to: inDays(17) })
      .expect(201);
  });

  it("narrows the list to what each role may see", async () => {
    await guest.post("/bookings").send(input).expect(201);
    await otherGuest
      .post("/bookings")
      .send({ ...input, from: inDays(19), to: inDays(21) })
      .expect(201);

    // A guest sees only their own; the owner of the listing sees both stays booked
    // against it; an admin sees everything there is.
    expect(await stays(guest)).toHaveLength(1);
    expect(await stays(otherGuest)).toHaveLength(1);
    expect(await stays(owner)).toHaveLength(2);
    expect(await stays(admin)).toHaveLength(2);
  });

  /**
   * A filter narrows the scope the role gives; it cannot reach around it. `guestId` is the
   * one worth proving, because it names the same column the guest's own scope does — the
   * repository `AND`s the two rather than spreading them, and this is what says so against
   * a real query.
   */
  it("filters inside the scope and never around it", async () => {
    await guest.post("/bookings").send(input).expect(201);
    const otherStay = await otherGuest
      .post("/bookings")
      .send({ ...input, from: inDays(19), to: inDays(21) })
      .expect(201);
    const otherGuestId = bookingSchema.parse(otherStay.body).guestId;

    expect(await stays(guest, { guestId: otherGuestId })).toHaveLength(0);
    expect(await stays(admin, { guestId: otherGuestId })).toHaveLength(1);
  });

  it("filters by the listing, by the status and by a window the stay overlaps", async () => {
    const second = await owner
      .post("/listings")
      .send({ ...listingInput, title: "Cabin by the lake" })
      .expect(201);
    const secondListingId = (second.body as { id: string }).id;

    await guest.post("/bookings").send(input).expect(201);
    const elsewhere = await guest
      .post("/bookings")
      .send({ listingId: secondListingId, from: inDays(30), to: inDays(32) })
      .expect(201);

    expect(await stays(guest, { listingId: secondListingId })).toHaveLength(1);
    expect(await stays(guest, { status: "PENDING_PAYMENT" })).toHaveLength(2);
    expect(await stays(guest, { status: "CANCELLED" })).toHaveLength(0);

    // The window is an overlap and not a bound on the check-in: a stay counts when it
    // touches these dates, which is the same half-open comparison POST /bookings makes.
    expect(
      await stays(guest, { from: inDays(11), to: inDays(12) }),
    ).toHaveLength(1);
    expect(
      await stays(guest, { from: inDays(0), to: inDays(40) }),
    ).toHaveLength(2);
    // Check-out is exclusive on both sides of the comparison: the morning a stay ends is
    // a day it no longer takes.
    expect(await stays(guest, { from: input.to, to: inDays(29) })).toHaveLength(
      0,
    );

    await guest
      .delete(`/bookings/${(elsewhere.body as { id: string }).id}`)
      .expect(204);

    // A cancelled stay stays readable and says so — the status is what changed, not who
    // may see the row.
    expect(await stays(guest, { status: "CANCELLED" })).toHaveLength(1);
  });

  it("orders by the ordering asked for, and pages by the cursor it issues", async () => {
    for (const start of [10, 20, 30]) {
      await guest
        .post("/bookings")
        .send({
          listingId: input.listingId,
          from: inDays(start),
          to: inDays(start + 2),
        })
        .expect(201);
    }

    const checkIns = async (
      search: Record<string, string>,
    ): Promise<string[]> =>
      (await stays(guest, search)).map((stay) => stay.from);

    await expect(checkIns({ sort: "checkInAsc" })).resolves.toEqual([
      inDays(10),
      inDays(20),
      inDays(30),
    ]);
    await expect(checkIns({ sort: "checkInDesc" })).resolves.toEqual([
      inDays(30),
      inDays(20),
      inDays(10),
    ]);
    // `newest` is the default and it is the moment the stay was taken, not the day it
    // starts — these were booked in ascending order of check-in.
    await expect(checkIns({})).resolves.toEqual([
      inDays(30),
      inDays(20),
      inDays(10),
    ]);

    const first = await page(guest, { sort: "checkInAsc", limit: "2" });

    expect(first.items.map((stay) => stay.from)).toEqual([
      inDays(10),
      inDays(20),
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await page(guest, {
      sort: "checkInAsc",
      limit: "2",
      cursor: String(first.nextCursor),
    });

    // No row twice and none skipped — what a keyset page buys over an offset that a stay
    // booked in between would shift.
    expect(second.items.map((stay) => stay.from)).toEqual([inDays(30)]);
    expect(second.nextCursor).toBeNull();
  });

  /**
   * A cursor names a place in one ordering and in no other, and both refusals are the
   * client's to act on: dropping the cursor starts the pages again, which is exactly what
   * changing the ordering means.
   */
  it("refuses a cursor from another ordering, and one it never issued", async () => {
    await guest.post("/bookings").send(input).expect(201);
    await guest
      .post("/bookings")
      .send({ ...input, from: inDays(19), to: inDays(21) })
      .expect(201);

    const first = await page(guest, { limit: "1" });
    const cursor = String(first.nextCursor);

    await guest
      .get("/bookings")
      .query({ limit: "1", cursor, sort: "oldest" })
      .expect(400);
    await guest.get("/bookings").query({ cursor: "not-a-cursor" }).expect(400);
  });

  it("shows one booking to its guest, to the owner of the listing and to an admin", async () => {
    const created = await guest.post("/bookings").send(input).expect(201);
    const id = (created.body as { id: string }).id;

    for (const agent of [guest, owner, admin]) {
      await agent.get(`/bookings/${id}`).expect(200);
    }

    // 404, not 403: nothing lets a stranger list bookings, so a 403 would be the one way
    // to learn that an id exists at all.
    await otherGuest.get(`/bookings/${id}`).expect(404);
  });

  it("is cancelled by its guest or an admin, and not by the owner of the listing", async () => {
    const first = await guest.post("/bookings").send(input).expect(201);
    const id = (first.body as { id: string }).id;

    // Reading the bookings against your listing is not the same right as cancelling one —
    // and the owner, who may read this one, is told so. A stranger gets the 404 they get
    // for reading it.
    await owner.delete(`/bookings/${id}`).expect(403);
    await otherGuest.delete(`/bookings/${id}`).expect(404);
    await guest.delete(`/bookings/${id}`).expect(204);

    // Not gone: the row is what phase 5 refunds against, so it keeps answering its guest
    // and says what happened. Cancelling it again is what is refused.
    const cancelled = await guest.get(`/bookings/${id}`).expect(200);

    expect(bookingSchema.parse(cancelled.body).status).toBe("CANCELLED");
    await guest.delete(`/bookings/${id}`).expect(404);

    const second = await guest.post("/bookings").send(input).expect(201);

    await admin
      .delete(`/bookings/${(second.body as { id: string }).id}`)
      .expect(204);
  });
});
