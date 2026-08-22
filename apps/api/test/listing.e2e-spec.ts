import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { App } from "supertest/types";
import {
  Role,
  apiErrorSchema,
  listingListSchema,
  listingSchema,
  type CreateListingInput,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { signInAs, type Agent } from "./session";

const input: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNight: 12000,
  capacity: 4,
};

describe("ListingController (e2e)", () => {
  let app: INestApplication<App>;
  let guest: Agent;
  let owner: Agent;
  let otherOwner: Agent;
  let admin: Agent;

  /** The id of a listing `owner` created before each test. */
  let listingId: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    await resetDatabase(app);

    guest = await signInAs(app, Role.USER);
    owner = await signInAs(app, Role.OWNER);
    otherOwner = await signInAs(app, Role.OWNER, {
      email: "e2e-owner-2@example.com",
      password: "password123",
    });
    admin = await signInAs(app, Role.ADMIN);

    const created = await owner.post("/listings").send(input).expect(201);
    listingId = (created.body as { id: string }).id;
  });

  afterEach(async () => {
    await app.close();
  });

  it("answers with a body matching the contract schema and an owner taken from the session", async () => {
    const response = await owner.get(`/listings/${listingId}`).expect(200);
    const listing = listingSchema.parse(response.body);
    const session = await owner.get("/auth/me").expect(200);

    expect(listing.ownerId).toBe((session.body as { id: string }).id);
  });

  it("ignores an ownerId sent by the client — it is not in the schema, so it is stripped", async () => {
    const impostor = "8c9d0e1f-2a3b-4c5d-9e6f-7a8b9c0d1e2f";
    const response = await owner
      .post("/listings")
      .send({ ...input, ownerId: impostor })
      .expect(201);

    expect(listingSchema.parse(response.body).ownerId).not.toBe(impostor);
  });

  it("refuses creation to a guest and to an admin — the role check, before any row", async () => {
    for (const agent of [guest, admin]) {
      await agent.post("/listings").send(input).expect(403);
    }
  });

  it("lets every signed-in role read the catalogue", async () => {
    for (const agent of [guest, owner, otherOwner, admin]) {
      const response = await agent.get("/listings").expect(200);

      expect(listingListSchema.parse(response.body)).toHaveLength(1);
    }
  });

  it("gives an owner only their own listings under /listings/mine", async () => {
    await otherOwner
      .post("/listings")
      .send({ ...input, title: "Cottage at the edge of the pines" })
      .expect(201);

    const mine = await owner.get("/listings/mine").expect(200);
    const all = await owner.get("/listings").expect(200);

    expect(listingListSchema.parse(mine.body)).toHaveLength(1);
    expect(listingListSchema.parse(all.body)).toHaveLength(2);
  });

  it("keeps /listings/mine to owners — a guest has none to list", async () => {
    await guest.get("/listings/mine").expect(403);
  });

  it("lets the owner edit their listing", async () => {
    const response = await owner
      .patch(`/listings/${listingId}`)
      .send({ pricePerNight: 13500 })
      .expect(200);

    expect(listingSchema.parse(response.body).pricePerNight).toBe(13500);
  });

  it("refuses the edit to another owner — the role passes, the ownership does not", async () => {
    await otherOwner
      .patch(`/listings/${listingId}`)
      .send({ pricePerNight: 1 })
      .expect(403);
  });

  it("lets an admin edit and delete a listing they do not own", async () => {
    await admin
      .patch(`/listings/${listingId}`)
      .send({ capacity: 8 })
      .expect(200);
    await admin.delete(`/listings/${listingId}`).expect(204);
    await owner.get(`/listings/${listingId}`).expect(404);
  });

  it("refuses to delete a listing with bookings against it", async () => {
    await guest
      .post("/bookings")
      .send({ listingId, from: inDays(10), to: inDays(14) })
      .expect(201);

    const response = await owner.delete(`/listings/${listingId}`).expect(409);

    expect(apiErrorSchema.parse(response.body).message).toContain(listingId);
  });

  it("rejects a body that does not pass the schema", async () => {
    await owner
      .post("/listings")
      .send({ ...input, capacity: 0 })
      .expect(400);
    // A PATCH that changes nothing is a mistake on the caller's side, not a no-op.
    await owner.patch(`/listings/${listingId}`).send({}).expect(400);
  });
});
