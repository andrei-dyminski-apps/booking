import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import {
  Role,
  managedUserDetailSchema,
  managedUserSchema,
  userPageSchema,
  type UserPage,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import {
  credentialsFor,
  hostCredentials,
  signIn,
  signInAs,
  type Agent,
} from "./session";

describe("UserController (e2e)", () => {
  let app: INestApplication<App>;
  let guest: Agent;
  let owner: Agent;
  let admin: Agent;

  const idOf = async (email: string): Promise<string> =>
    (
      await app
        .get(PrismaService)
        .user.findUniqueOrThrow({ where: { email }, select: { id: true } })
    ).id;

  const page = async (query = ""): Promise<UserPage> => {
    const response = await admin.get(`/users${query}`).expect(200);

    return userPageSchema.parse(response.body);
  };

  const emails = (answer: UserPage): string[] =>
    answer.items.map((user) => user.email);

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    await resetDatabase(app);

    guest = await signInAs(app, Role.USER);
    owner = await signIn(app, hostCredentials);
    admin = await signInAs(app, Role.ADMIN);
  });

  afterEach(async () => {
    await app.close();
  });

  it("is the admin's alone", async () => {
    await guest.get("/users").expect(403);
    await owner.get("/users").expect(403);
    await request(app.getHttpServer()).get("/users").expect(401);

    const guestId = await idOf(credentialsFor.USER.email);

    await owner.patch(`/users/${guestId}`).send({ blocked: true }).expect(403);
    await owner.get(`/users/${guestId}`).expect(403);
  });

  it("reads one account with the stays it took and the listings it still offers", async () => {
    const listing = {
      description: "Two rooms under the roof and a wall of glass.",
      pricePerNight: 120,
      capacity: 4,
    };
    const kept = await owner
      .post("/listings")
      .send({ ...listing, title: "Loft" })
      .expect(201);
    const retired = await owner
      .post("/listings")
      .send({ ...listing, title: "Attic" })
      .expect(201);
    await owner
      .delete(`/listings/${(retired.body as { id: string }).id}`)
      .expect(204);
    await guest
      .post("/bookings")
      .send({
        listingId: (kept.body as { id: string }).id,
        from: inDays(10),
        to: inDays(12),
      })
      .expect(201);

    const ownerId = await idOf(hostCredentials.email);
    const guestId = await idOf(credentialsFor.USER.email);

    expect(
      managedUserDetailSchema.parse(
        (await admin.get(`/users/${ownerId}`).expect(200)).body,
      ),
    ).toMatchObject({ role: Role.USER, bookingCount: 0, listingCount: 1 });
    expect(
      managedUserDetailSchema.parse(
        (await admin.get(`/users/${guestId}`).expect(200)).body,
      ),
    ).toMatchObject({ role: Role.USER, bookingCount: 1, listingCount: 0 });
  });

  it("answers 404 for an unknown account and 400 for an id that is not one", async () => {
    await admin.get("/users/0b6f7f6e-2f4c-4a52-9a5e-8f1f6d2c3b4a").expect(404);
    await admin.get("/users/not-an-id").expect(400);
  });

  it("pages every account, newest first, and back the other way", async () => {
    const first = await page("?limit=2");

    expect(emails(first)).toEqual([
      credentialsFor.ADMIN.email,
      hostCredentials.email,
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await page(
      `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
    );

    expect(emails(second)).toEqual([credentialsFor.USER.email]);
    expect(second.nextCursor).toBeNull();

    expect(emails(await page("?sort=oldest"))).toEqual([
      credentialsFor.USER.email,
      hostCredentials.email,
      credentialsFor.ADMIN.email,
    ]);
  });

  it("filters by role, by a part of the name or the address, and by whether the account is blocked", async () => {
    expect(emails(await page("?role=ADMIN"))).toEqual([
      credentialsFor.ADMIN.email,
    ]);
    // Any part of it, in any case: what an admin remembers of an address.
    expect(emails(await page("?email=E2E-OWN"))).toEqual([
      hostCredentials.email,
    ]);
    // Taken as written: `LIKE` would read these two as wildcards and match every address.
    expect(emails(await page("?email=%25"))).toEqual([]);
    expect(emails(await page("?email=e2e_"))).toEqual([]);
    // A name is stored as typed, so it is the match that ignores the case.
    expect(emails(await page("?name=e2e%20own"))).toEqual([
      hostCredentials.email,
    ]);
    expect(emails(await page("?name=%25"))).toEqual([]);

    const guestId = await idOf(credentialsFor.USER.email);

    await admin.patch(`/users/${guestId}`).send({ blocked: true }).expect(200);

    expect(emails(await page("?status=BLOCKED"))).toEqual([
      credentialsFor.USER.email,
    ]);
    expect(emails(await page("?status=ACTIVE"))).not.toContain(
      credentialsFor.USER.email,
    );
  });

  it("refuses a filter the contract refuses, and a cursor it did not issue", async () => {
    await admin.get("/users?role=SUPERUSER").expect(400);
    await admin.get("/users?email=%20%20").expect(400);
    await admin.get("/users?name=%20%20").expect(400);
    await admin.get("/users?cursor=not-a-cursor").expect(400);
  });

  it("changes a role, which the account carries from its next sign-in", async () => {
    const guestId = await idOf(credentialsFor.USER.email);

    const promoted = await admin
      .patch(`/users/${guestId}`)
      .send({ role: Role.ADMIN })
      .expect(200);

    expect(managedUserSchema.parse(promoted.body).role).toBe(Role.ADMIN);

    // The access token in the agent still says USER: `JwtStrategy` reads no database.
    await guest.get("/users").expect(403);
    await guest.post("/auth/login").send(credentialsFor.USER).expect(200);
    await guest.get("/users").expect(200);
    await guest.get("/listings/mine").expect(403);

    const demoted = await admin
      .patch(`/users/${guestId}`)
      .send({ role: Role.USER })
      .expect(200);

    expect(managedUserSchema.parse(demoted.body).role).toBe(Role.USER);

    await guest.post("/auth/login").send(credentialsFor.USER).expect(200);
    await guest.get("/listings/mine").expect(200);
    await guest.get("/users").expect(403);
  });

  it("blocks an account: no refresh, no new sign-in, and `/auth/me` reads it as signed out", async () => {
    const guestId = await idOf(credentialsFor.USER.email);

    const response = await admin
      .patch(`/users/${guestId}`)
      .send({ blocked: true })
      .expect(200);

    expect(managedUserSchema.parse(response.body).blockedAt).not.toBeNull();

    // `/auth/me` first: the failed refresh below clears the agent's cookies, and a request
    // without an access token is a 401 from the guard, whatever the row says.
    await guest.get("/auth/me").expect(401);
    await guest.post("/auth/refresh").expect(401);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send(credentialsFor.USER)
      .expect(403);
    // The block is news only to whoever already has the password.
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ ...credentialsFor.USER, password: "wrong-password" })
      .expect(401);

    expect(
      await app
        .get(PrismaService)
        .refreshToken.count({ where: { userId: guestId } }),
    ).toBe(0);
  });

  it("keeps the moment an account was first blocked, and unblocks it", async () => {
    const guestId = await idOf(credentialsFor.USER.email);

    const first = await admin
      .patch(`/users/${guestId}`)
      .send({ blocked: true })
      .expect(200);
    const again = await admin
      .patch(`/users/${guestId}`)
      .send({ blocked: true })
      .expect(200);

    expect(managedUserSchema.parse(again.body).blockedAt).toBe(
      managedUserSchema.parse(first.body).blockedAt,
    );

    const reopened = await admin
      .patch(`/users/${guestId}`)
      .send({ blocked: false })
      .expect(200);

    expect(managedUserSchema.parse(reopened.body).blockedAt).toBeNull();
    await request(app.getHttpServer())
      .post("/auth/login")
      .send(credentialsFor.USER)
      .expect(200);
  });

  it("refuses a change from an admin who has been demoted since signing in", async () => {
    const adminId = await idOf(credentialsFor.ADMIN.email);
    const guestId = await idOf(credentialsFor.USER.email);

    // The token in the agent still says ADMIN, and the guard believes it; the row does not.
    await app
      .get(PrismaService)
      .user.update({ where: { id: adminId }, data: { role: Role.USER } });

    await admin.patch(`/users/${guestId}`).send({ blocked: true }).expect(403);
    expect(
      await app
        .get(PrismaService)
        .user.findUniqueOrThrow({ where: { id: guestId } }),
    ).toMatchObject({ blockedAt: null });
  });

  it("lets only one of two admins blocking each other at once through", async () => {
    const second = await signInAs(app, Role.ADMIN, {
      name: "E2E Second Admin",
      email: "e2e-admin-2@example.com",
      password: "password123",
    });
    const adminId = await idOf(credentialsFor.ADMIN.email);
    const secondId = await idOf("e2e-admin-2@example.com");

    const statuses = await Promise.all([
      admin.patch(`/users/${secondId}`).send({ blocked: true }),
      second.patch(`/users/${adminId}`).send({ blocked: true }),
    ]).then((responses) => responses.map((response) => response.status));

    expect(statuses.sort()).toEqual([200, 403]);
    expect(
      await app
        .get(PrismaService)
        .user.count({ where: { role: Role.ADMIN, blockedAt: null } }),
    ).toBe(1);
  });

  it("refuses an admin's change to their own account, an empty change and an unknown id", async () => {
    const adminId = await idOf(credentialsFor.ADMIN.email);

    await admin
      .patch(`/users/${adminId}`)
      .send({ role: Role.USER })
      .expect(403);
    await admin.patch(`/users/${adminId}`).send({ blocked: true }).expect(403);
    // The same row to Postgres, and a different string to a naive comparison.
    await admin
      .patch(`/users/${adminId.toUpperCase()}`)
      .send({ blocked: true })
      .expect(403);

    const guestId = await idOf(credentialsFor.USER.email);

    await admin.patch(`/users/${guestId}`).send({}).expect(400);
    await admin
      .patch("/users/0b6f7f6e-2f4c-4a52-9a5e-8f1f6d2c3b4a")
      .send({ blocked: true })
      .expect(404);
  });
});
