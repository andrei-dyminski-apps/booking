import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import { Role, lookupPageSchema, type LookupPage } from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { credentialsFor, signIn, signInAs, type Agent } from "./session";

const LISTING = {
  description: "Two rooms under the roof and a wall of glass.",
  pricePerNight: 120,
  capacity: 4,
};

/** A second owner, with listings nobody has stayed in. */
const otherOwner = {
  name: "E2E Other Owner",
  email: "e2e-other-owner@example.com",
  password: "password123",
};

describe("LookupController (e2e)", () => {
  let app: INestApplication<App>;
  let guest: Agent;
  let owner: Agent;
  let other: Agent;
  let admin: Agent;
  let loftId: string;
  let retiredId: string;

  const lookup = async (
    agent: Agent,
    path: string,
    q: string,
    extra = "",
  ): Promise<LookupPage> => {
    const response = await agent
      .get(`/lookups/${path}?q=${encodeURIComponent(q)}${extra}`)
      .expect(200);

    return lookupPageSchema.parse(response.body);
  };

  const labels = (answer: LookupPage): string[] =>
    answer.items.map((item) => item.label);

  const publish = async (agent: Agent, title: string): Promise<string> =>
    (
      (
        await agent
          .post("/listings")
          .send({ ...LISTING, title })
          .expect(201)
      ).body as { id: string }
    ).id;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    await resetDatabase(app);

    guest = await signInAs(app, Role.USER);
    owner = await signInAs(app, Role.OWNER);
    other = await signInAs(app, Role.OWNER, otherOwner);
    admin = await signInAs(app, Role.ADMIN);

    loftId = await publish(owner, "Loft by the river");
    retiredId = await publish(owner, "Riverside cabin");
    await publish(other, "River house nobody booked");

    for (const [listingId, from] of [
      [loftId, 10],
      [retiredId, 20],
    ] as const) {
      await guest
        .post("/bookings")
        .send({ listingId, from: inDays(from), to: inDays(from + 2) })
        .expect(201);
    }

    await owner.delete(`/listings/${retiredId}`).expect(204);
  });

  afterEach(async () => {
    await app.close();
  });

  it("opens each lookup to the roles whose filter it fills in", async () => {
    await request(app.getHttpServer()).get("/lookups/owners?q=e2e").expect(401);
    await owner.get("/lookups/owners?q=e2e").expect(403);
    await guest.get("/lookups/guests?q=e2e").expect(403);
  });

  it("refuses a search shorter than three characters", async () => {
    await admin.get("/lookups/owners?q=e2").expect(400);
    await admin.get("/lookups/owners?q=%20%20e2%20").expect(400);
  });

  it("offers the owners of what is on offer by name, with the address beside it", async () => {
    const owners = await lookup(admin, "owners", "OWNER");

    expect(owners.items.map(({ label, hint }) => [label, hint])).toEqual([
      [otherOwner.name, otherOwner.email],
      [credentialsFor.OWNER.name, credentialsFor.OWNER.email],
    ]);
    // An admin may look an account up by its address as well.
    expect(labels(await lookup(admin, "owners", "other-owner@"))).toEqual([
      otherOwner.name,
    ]);
    // The guest and the admin offer nothing, so neither is an owner to filter by.
    expect(labels(await lookup(admin, "owners", "e2e@"))).toEqual([]);
  });

  it("matches an id whole, and never a part of one", async () => {
    expect(labels(await lookup(owner, "listings", loftId))).toEqual([
      "Loft by the river",
    ]);
    expect(labels(await lookup(owner, "listings", loftId.slice(0, 8)))).toEqual(
      [],
    );
  });

  it("offers the listings of the caller's stays, retired ones included", async () => {
    expect(labels(await lookup(owner, "listings", "RIVER"))).toEqual([
      "Loft by the river",
      "Riverside cabin",
    ]);
    // Their own listing has no stays, and somebody else's are not theirs to filter by.
    expect(labels(await lookup(other, "listings", "river"))).toEqual([]);
    expect(labels(await lookup(admin, "listings", "river"))).toHaveLength(2);
    // A guest is offered the listings they stayed in, and nothing else of the catalogue.
    expect(labels(await lookup(guest, "listings", "river"))).toEqual([
      "Loft by the river",
      "Riverside cabin",
    ]);
  });

  it("offers the guests of the caller's stays", async () => {
    expect(labels(await lookup(owner, "guests", "e2e"))).toEqual([
      credentialsFor.USER.name,
    ]);
    expect(labels(await lookup(other, "guests", "e2e"))).toEqual([]);
    expect(labels(await lookup(admin, "guests", "example"))).toEqual([
      credentialsFor.USER.name,
    ]);
  });

  it("shows a host the names of their guests and never the addresses", async () => {
    const guests = await lookup(owner, "guests", "guest");

    expect(guests.items).toEqual([
      expect.objectContaining({ label: credentialsFor.USER.name, hint: null }),
    ]);
    // An address is neither shown to a host nor something they can search by.
    expect(labels(await lookup(owner, "guests", "e2e@example"))).toEqual([]);

    expect((await lookup(admin, "guests", "guest")).items).toEqual([
      expect.objectContaining({
        label: credentialsFor.USER.name,
        hint: credentialsFor.USER.email,
      }),
    ]);
  });

  it("reads a wildcard as the character it is", async () => {
    expect(labels(await lookup(admin, "listings", "%%%"))).toEqual([]);
    expect(labels(await lookup(admin, "owners", "___"))).toEqual([]);
  });

  it("pages through the matches in the order of their names", async () => {
    const first = await lookup(owner, "listings", "river", "&limit=1");

    expect(labels(first)).toEqual(["Loft by the river"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await lookup(
      owner,
      "listings",
      "river",
      `&limit=1&cursor=${first.nextCursor ?? ""}`,
    );

    expect(labels(second)).toEqual(["Riverside cabin"]);
    expect(second.nextCursor).toBeNull();

    // A cursor of the listings is not a place among the guests.
    await owner
      .get(`/lookups/guests?q=e2e&cursor=${first.nextCursor ?? ""}`)
      .expect(400);
  });

  it("pages past two guests of one name by their ids", async () => {
    for (const [index, from] of [
      [1, 30],
      [2, 40],
    ] as const) {
      const twin = await signIn(app, {
        name: "E2E Twin",
        email: `e2e-twin-${index}@example.com`,
        password: "password123",
      });

      await twin
        .post("/bookings")
        .send({ listingId: loftId, from: inDays(from), to: inDays(from + 2) })
        .expect(201);
    }

    const first = await lookup(owner, "guests", "twin", "&limit=1");
    const second = await lookup(
      owner,
      "guests",
      "twin",
      `&limit=1&cursor=${first.nextCursor ?? ""}`,
    );
    const ids = [...first.items, ...second.items].map((item) => item.id);

    // Accounts are no longer ordered by a unique column, so the id behind the name is
    // what moves the second page past the first rather than back onto it.
    expect(labels(first)).toEqual(["E2E Twin"]);
    expect(labels(second)).toEqual(["E2E Twin"]);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual([...ids].sort());
    expect(second.nextCursor).toBeNull();
  });
});
