import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import { apiErrorSchema, userSchema } from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from "./../src/auth/cookies";
import { resetDatabase } from "./database";
import { readSetCookie, signIn, testCredentials } from "./session";

describe("AuthController (e2e)", () => {
  let app: INestApplication<App>;
  let server: App;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer();

    // Tests hit the real database from docker-compose — wipe it before each one.
    // Deleting the users takes their refresh tokens along (onDelete: Cascade).
    await resetDatabase(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it("registers and hands the session over as two httpOnly cookies", async () => {
    const response = await request(server)
      .post("/auth/register")
      .send(testCredentials)
      .expect(201);

    const user = userSchema.parse(response.body);

    expect(user.email).toBe(testCredentials.email);
    expect(user.name).toBe(testCredentials.name);
    expect(user.role).toBe("USER");
    // Nothing in the body is a credential — the tokens leave only through Set-Cookie.
    expect(JSON.stringify(response.body)).not.toContain("token");

    const cookies = (response.headers as Record<string, unknown>)["set-cookie"];

    expect(cookies).toEqual([
      expect.stringContaining(`${ACCESS_TOKEN_COOKIE}=`),
      expect.stringContaining(`${REFRESH_TOKEN_COOKIE}=`),
    ]);
    expect(String(cookies)).toContain("HttpOnly");
    // The refresh token is scoped to the two routes that consume it.
    expect(readSetCookie(response, REFRESH_TOKEN_COOKIE)).not.toBeNull();
    expect(String(cookies)).toContain("Path=/auth");
  });

  it("rejects a second registration of the same email with 409", async () => {
    await request(server)
      .post("/auth/register")
      .send(testCredentials)
      .expect(201);

    const response = await request(server)
      .post("/auth/register")
      .send(testCredentials)
      .expect(409);

    expect(apiErrorSchema.parse(response.body).code).toBe(
      "EMAIL_ALREADY_REGISTERED",
    );
  });

  it("rejects a password the contract schema refuses", async () => {
    const response = await request(server)
      .post("/auth/register")
      .send({ ...testCredentials, password: "short" })
      .expect(400);

    const error = apiErrorSchema.parse(response.body);

    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.errors).toEqual([
      expect.objectContaining({
        path: ["password"],
        code: "PASSWORD_TOO_SHORT",
        params: { minimum: 8 },
      }),
    ]);
  });

  it("rejects a name that is only whitespace", async () => {
    const response = await request(server)
      .post("/auth/register")
      .send({ ...testCredentials, name: "   " })
      .expect(400);

    const error = apiErrorSchema.parse(response.body);

    expect(error.errors).toEqual([
      expect.objectContaining({ path: ["name"], code: "NAME_REQUIRED" }),
    ]);
  });

  it("rejects a name with no letter in it, however long", async () => {
    const response = await request(server)
      .post("/auth/register")
      .send({ ...testCredentials, name: "\u200b\u200b\u200b" })
      .expect(400);

    const error = apiErrorSchema.parse(response.body);

    expect(error.errors).toEqual([expect.objectContaining({ path: ["name"] })]);
  });

  it("normalises the email, so the address is stored and matched in one shape", async () => {
    await request(server)
      .post("/auth/register")
      .send({ ...testCredentials, email: "E2E@Example.COM" })
      .expect(201);

    const response = await request(server)
      .post("/auth/login")
      .send(testCredentials)
      .expect(200);

    expect(userSchema.parse(response.body).email).toBe(testCredentials.email);
  });

  it("answers a wrong password with 401 and the same message as an unknown email", async () => {
    await request(server)
      .post("/auth/register")
      .send(testCredentials)
      .expect(201);

    const wrongPassword = await request(server)
      .post("/auth/login")
      .send({ ...testCredentials, password: "wrong-password" })
      .expect(401);

    const unknownEmail = await request(server)
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: "password123" })
      .expect(401);

    expect(apiErrorSchema.parse(wrongPassword.body).message).toBe(
      apiErrorSchema.parse(unknownEmail.body).message,
    );
    expect(apiErrorSchema.parse(wrongPassword.body).code).toBe(
      "INVALID_CREDENTIALS",
    );
    expect(apiErrorSchema.parse(unknownEmail.body).code).toBe(
      "INVALID_CREDENTIALS",
    );
  });

  it("gives a code to the answers that are not an exception of ours", async () => {
    // The body parser's refusal is an http-errors error, and an unknown route is Nest's
    // own 404: neither names a code, so the filter has to.
    const malformed = await request(server)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send("{ not json")
      .expect(400);

    expect(apiErrorSchema.parse(malformed.body).code).toBe("BAD_REQUEST");

    const unknown = await request(server).get("/no-such-route").expect(404);

    expect(apiErrorSchema.parse(unknown.body).code).toBe("NOT_FOUND");
  });

  it("closes /auth/me without a session and answers it with one", async () => {
    const refused = await request(server).get("/auth/me").expect(401);

    // The guard is Passport's, which names no code: the filter answers with the status's.
    expect(apiErrorSchema.parse(refused.body).code).toBe("UNAUTHORIZED");

    const agent = await signIn(app);
    const response = await agent.get("/auth/me").expect(200);

    expect(userSchema.parse(response.body).email).toBe(testCredentials.email);
  });

  it("closes /bookings too — the guard is global, not per-controller", async () => {
    await request(server).get("/bookings").expect(401);
  });

  it("rotates the refresh token: the previous one stops working", async () => {
    const agent = request.agent(server);
    const registered = await agent
      .post("/auth/register")
      .send(testCredentials)
      .expect(201);

    const firstToken = readSetCookie(registered, REFRESH_TOKEN_COOKIE);
    const rotated = await agent.post("/auth/refresh").expect(200);

    expect(readSetCookie(rotated, REFRESH_TOKEN_COOKIE)).not.toBe(firstToken);

    // The rotated-away token is still a valid JWT — only the database knows it is spent.
    await request(server)
      .post("/auth/refresh")
      .set("Cookie", `${REFRESH_TOKEN_COOKIE}=${firstToken ?? ""}`)
      .expect(401);
  });

  it("kills the whole chain when a spent refresh token is replayed", async () => {
    const agent = request.agent(server);
    const registered = await agent
      .post("/auth/register")
      .send(testCredentials)
      .expect(201);

    const stolenToken = readSetCookie(registered, REFRESH_TOKEN_COOKIE);

    await agent.post("/auth/refresh").expect(200);

    const replayed = await request(server)
      .post("/auth/refresh")
      .set("Cookie", `${REFRESH_TOKEN_COOKIE}=${stolenToken ?? ""}`)
      .expect(401);

    expect(apiErrorSchema.parse(replayed.body).code).toBe(
      "REFRESH_TOKEN_REUSED",
    );

    // The agent holds the current, never-used token — and it is dead as well: the replay
    // proved a copy of the chain exists, and there is no telling which side holds it.
    await agent.post("/auth/refresh").expect(401);
  });

  it("names why a refresh was refused: no cookie, a token that is no token, one nobody stored", async () => {
    const missing = await request(server).post("/auth/refresh").expect(401);

    expect(apiErrorSchema.parse(missing.body).code).toBe(
      "REFRESH_TOKEN_MISSING",
    );

    const garbage = await request(server)
      .post("/auth/refresh")
      .set("Cookie", `${REFRESH_TOKEN_COOKIE}=not-a-token`)
      .expect(401);

    expect(apiErrorSchema.parse(garbage.body).code).toBe(
      "REFRESH_TOKEN_INVALID",
    );

    // Signed with the real key, so it is the database that has never heard of it: the
    // row is gone (a logout only revokes the family, which reads as a replay instead).
    const agent = request.agent(server);
    const registered = await agent
      .post("/auth/register")
      .send(testCredentials)
      .expect(201);
    const token = readSetCookie(registered, REFRESH_TOKEN_COOKIE) ?? "";

    await app.get(PrismaService).refreshToken.deleteMany();

    const unstored = await request(server)
      .post("/auth/refresh")
      .set("Cookie", `${REFRESH_TOKEN_COOKIE}=${token}`)
      .expect(401);

    expect(apiErrorSchema.parse(unstored.body).code).toBe(
      "REFRESH_TOKEN_UNKNOWN",
    );
  });

  it("answers an ended session with SESSION_NOT_FOUND once the row behind a signed token is gone", async () => {
    const agent = await signIn(app);

    await app
      .get(PrismaService)
      .user.delete({ where: { email: testCredentials.email } });

    const refused = await agent.get("/auth/me").expect(401);

    expect(apiErrorSchema.parse(refused.body).code).toBe("SESSION_NOT_FOUND");
  });

  it("tells a blocked account so only once the password is right", async () => {
    await request(server)
      .post("/auth/register")
      .send(testCredentials)
      .expect(201);
    await app.get(PrismaService).user.update({
      where: { email: testCredentials.email },
      data: { blockedAt: new Date() },
    });

    const wrong = await request(server)
      .post("/auth/login")
      .send({ ...testCredentials, password: "wrong-password" })
      .expect(401);
    const blocked = await request(server)
      .post("/auth/login")
      .send(testCredentials)
      .expect(403);

    expect(apiErrorSchema.parse(wrong.body).code).toBe("INVALID_CREDENTIALS");
    expect(apiErrorSchema.parse(blocked.body).code).toBe("ACCOUNT_BLOCKED");
  });

  it("never mints two sessions out of two parallel refreshes", async () => {
    const agent = request.agent(server);
    const registered = await agent
      .post("/auth/register")
      .send(testCredentials)
      .expect(201);

    const token = readSetCookie(registered, REFRESH_TOKEN_COOKIE) ?? "";
    const refresh = () =>
      request(server)
        .post("/auth/refresh")
        .set("Cookie", `${REFRESH_TOKEN_COOKIE}=${token}`);

    const [first, second] = await Promise.all([refresh(), refresh()]);

    // Which branch the loser lands in is not decided here: if it read the row before the
    // winner burned it, it is the lost race of a double-clicked button; if after, it is
    // indistinguishable from a replay and takes the family down. Only one thing holds
    // whichever way the two interleave, and it is the one that matters to a client — one
    // refresh of one token yields one session, never two.
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
      200, 401,
    ]);
  });

  it("logs out: the cookies are cleared and the session cannot be refreshed", async () => {
    const agent = await signIn(app);

    await agent.post("/auth/logout").expect(204);
    await agent.get("/auth/me").expect(401);
    await agent.post("/auth/refresh").expect(401);
  });

  it("logs out without a session as well — the endpoint is idempotent", async () => {
    await request(server).post("/auth/logout").expect(204);
  });

  it("answers 401, not 500, to a cookie that is not valid percent-encoding", async () => {
    // The header is whatever the client typed: "%" alone makes decodeURIComponent throw,
    // and an unhandled throw inside the guard would turn a bad credential into a 500.
    await request(server)
      .get("/bookings")
      .set("Cookie", `${ACCESS_TOKEN_COOKIE}=%`)
      .expect(401);

    await request(server)
      .post("/auth/refresh")
      .set("Cookie", `${REFRESH_TOKEN_COOKIE}=%E0%A4%A`)
      .expect(401);
  });

  it("clears the cookies when a refresh fails, so the dead token is not retried forever", async () => {
    const agent = request.agent(server);
    const registered = await agent
      .post("/auth/register")
      .send(testCredentials)
      .expect(201);

    const spent = readSetCookie(registered, REFRESH_TOKEN_COOKIE);

    await agent.post("/auth/refresh").expect(200);

    const replayed = await request(server)
      .post("/auth/refresh")
      .set("Cookie", `${REFRESH_TOKEN_COOKIE}=${spent ?? ""}`)
      .expect(401);

    // Both cookies come back emptied and expired — the browser drops them and the client
    // ends up at the login form instead of retrying a credential that can never work.
    expect(readSetCookie(replayed, REFRESH_TOKEN_COOKIE)).toBe("");
    expect(readSetCookie(replayed, ACCESS_TOKEN_COOKIE)).toBe("");
  });

  it("limits the guesses: the eleventh login in a minute is a 429", async () => {
    await request(server)
      .post("/auth/register")
      .send(testCredentials)
      .expect(201);

    const attempt = () =>
      request(server)
        .post("/auth/login")
        .send({ ...testCredentials, password: "wrong-password" });

    // Ten wrong guesses fit inside the limit; the register above does not count against
    // it, because each handler gets a bucket of its own.
    for (let index = 0; index < 10; index += 1) {
      await attempt().expect(401);
    }

    const limited = await attempt().expect(429);

    // What /docs promises a client about the wait (`addSharedResponses`).
    expect(limited.headers["retry-after"]).toMatch(/^\d+$/);
  });
});
