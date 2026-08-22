import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { App } from "supertest/types";
import {
  Role,
  apiErrorSchema,
  bookingListSchema,
  bookingSchema,
  type CreateBookingInput,
  type CreateListingInput,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { signInAs, type Agent } from "./session";

const listingInput: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNight: 12000,
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

    // Tests hit the real database from docker-compose — wipe it before each one.
    await resetDatabase(app);

    guest = await signInAs(app, Role.USER);
    otherGuest = await signInAs(app, Role.USER, {
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

  it("creates a booking and answers with a body matching the contract schema", async () => {
    const response = await guest.post("/bookings").send(input).expect(201);
    const booking = bookingSchema.parse(response.body);
    const session = await guest.get("/auth/me").expect(200);

    // The guest is the session, not a field of the request.
    expect(booking.guestId).toBe((session.body as { id: string }).id);
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

    const seenBy = async (agent: Agent): Promise<number> =>
      bookingListSchema.parse((await agent.get("/bookings").expect(200)).body)
        .length;

    // A guest sees only their own; the owner of the listing sees both stays booked
    // against it; an admin sees everything there is.
    expect(await seenBy(guest)).toBe(1);
    expect(await seenBy(otherGuest)).toBe(1);
    expect(await seenBy(owner)).toBe(2);
    expect(await seenBy(admin)).toBe(2);
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
    await guest.get(`/bookings/${id}`).expect(404);

    const second = await guest.post("/bookings").send(input).expect(201);

    await admin
      .delete(`/bookings/${(second.body as { id: string }).id}`)
      .expect(204);
  });
});
