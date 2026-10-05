import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import {
  Role,
  managedUserSchema,
  userPageSchema,
  type UserPage,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { credentialsFor, signInAs, type Agent } from "./session";

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
    owner = await signInAs(app, Role.OWNER);
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
  });

  it("pages every account, newest first, and back the other way", async () => {
    const first = await page("?limit=2");

    expect(emails(first)).toEqual([
      credentialsFor.ADMIN.email,
      credentialsFor.OWNER.email,
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await page(
      `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
    );

    expect(emails(second)).toEqual([credentialsFor.USER.email]);
    expect(second.nextCursor).toBeNull();

    expect(emails(await page("?sort=oldest"))).toEqual([
      credentialsFor.USER.email,
      credentialsFor.OWNER.email,
      credentialsFor.ADMIN.email,
    ]);
  });

  it("filters by role, by a part of the address, and by whether the account is blocked", async () => {
    expect(emails(await page("?role=OWNER"))).toEqual([
      credentialsFor.OWNER.email,
    ]);
    // Any part of it, in any case: what an admin remembers of an address.
    expect(emails(await page("?email=E2E-OWN"))).toEqual([
      credentialsFor.OWNER.email,
    ]);

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
    await admin.get("/users?cursor=not-a-cursor").expect(400);
  });

  it("changes a role, which the account carries from its next sign-in", async () => {
    const guestId = await idOf(credentialsFor.USER.email);

    const response = await admin
      .patch(`/users/${guestId}`)
      .send({ role: Role.OWNER })
      .expect(200);

    expect(managedUserSchema.parse(response.body).role).toBe(Role.OWNER);

    // The access token in the agent still says USER: `JwtStrategy` reads no database.
    await guest.get("/listings/mine").expect(403);
    await guest.post("/auth/login").send(credentialsFor.USER).expect(200);
    await guest.get("/listings/mine").expect(200);
  });

  it("blocks an account: no refresh, no new sign-in, and `/auth/me` reads it as signed out", async () => {
    const guestId = await idOf(credentialsFor.USER.email);

    const response = await admin
      .patch(`/users/${guestId}`)
      .send({ blocked: true })
      .expect(200);

    expect(managedUserSchema.parse(response.body).blockedAt).not.toBeNull();

    await guest.post("/auth/refresh").expect(401);
    await guest.get("/auth/me").expect(401);
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

  it("refuses an admin's change to their own account, an empty change and an unknown id", async () => {
    const adminId = await idOf(credentialsFor.ADMIN.email);

    await admin
      .patch(`/users/${adminId}`)
      .send({ role: Role.USER })
      .expect(403);
    await admin.patch(`/users/${adminId}`).send({ blocked: true }).expect(403);

    const guestId = await idOf(credentialsFor.USER.email);

    await admin.patch(`/users/${guestId}`).send({}).expect(400);
    await admin
      .patch("/users/0b6f7f6e-2f4c-4a52-9a5e-8f1f6d2c3b4a")
      .send({ blocked: true })
      .expect(404);
  });
});
