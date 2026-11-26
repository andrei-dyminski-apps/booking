import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import {
  apiErrorSchema,
  DEMO_ACCOUNT_EMAILS,
  userSchema,
} from "@repo/contracts";
import { addHours } from "date-fns";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/prisma/prisma.service";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from "../../src/auth/cookies";
import { issueCodesOf } from "../support/api-error";
import { resetDatabase } from "../support/database";
import {
  hostCredentials,
  readSetCookie,
  signIn,
  signInAs,
  testCredentials as fixtureCredentials,
} from "../support/session";
import {
  accountMailToken,
  hashMailToken,
} from "../../src/mail/application/mail-content";
import { MailOutboxRelay } from "../../src/mail/infrastructure/mail-outbox.relay";
import { EventStream } from "../support/event-stream";
import { waitUntil } from "../support/wait-until";

const testCredentials = { ...fixtureCredentials, email: "e2e@mail.test" };

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

  async function registrationToken(email = testCredentials.email) {
    await request(server).post("/auth/register").send({ email }).expect(202);
    return accountMailToken((await sentLink("register", email)).id);
  }

  async function sentLink(
    kind: "register" | "reset" | "change",
    email: string,
  ) {
    const db = app.get(PrismaService);
    await app.get(MailOutboxRelay).sweep();
    await waitUntil(async () => {
      const link = await db.accountMail.findFirst({
        where: { email, kind, expiresAt: { gt: new Date() } },
      });
      return link !== null;
    });
    return db.accountMail.findFirstOrThrow({ where: { email, kind } });
  }

  async function endsEventStream(updateCredentials: () => Promise<unknown>) {
    const stream = await EventStream.openAs(app, testCredentials);
    try {
      await expect(stream.next()).resolves.toMatchObject({ type: "sync" });
      await updateCredentials();
      await expect(stream.next()).rejects.toThrow("The stream ended");
    } finally {
      stream.close();
    }
  }

  afterEach(async () => {
    await app.close();
  });

  it("registers and hands the session over as two httpOnly cookies", async () => {
    const response = await request(server)
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: await registrationToken() })
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

  it("responds uniformly and reserves no account before the email link is completed", async () => {
    const invalidRegistration = { ...testCredentials, next: "/profile\0" };
    const invalidForUnknown = await request(server)
      .post("/auth/register")
      .send(invalidRegistration)
      .expect(400);
    expect(apiErrorSchema.parse(invalidForUnknown.body).errors).toEqual([
      expect.objectContaining({ path: ["next"] }),
    ]);

    const unknown = await request(server)
      .post("/auth/register")
      .send(testCredentials)
      .expect(202);
    expect(readSetCookie(unknown, ACCESS_TOKEN_COOKIE)).toBeNull();
    expect(await app.get(PrismaService).user.count()).toBe(0);
    const token = await registrationToken();

    await request(server)
      .post("/auth/register/complete")
      .send({ ...testCredentials, token })
      .expect(201);
    const existing = await request(server)
      .post("/auth/register")
      .send(testCredentials)
      .expect(202);
    expect(existing.text).toBe(unknown.text);
    expect(readSetCookie(existing, ACCESS_TOKEN_COOKIE)).toBeNull();
    const invalidForExisting = await request(server)
      .post("/auth/register")
      .send(invalidRegistration)
      .expect(400);
    expect(apiErrorSchema.parse(invalidForExisting.body).errors).toEqual(
      apiErrorSchema.parse(invalidForUnknown.body).errors,
    );
    await request(server)
      .post("/auth/register/complete")
      .send({ ...testCredentials, token })
      .expect(400);
  });

  it("rejects a password the contract schema refuses", async () => {
    const response = await request(server)
      .post("/auth/register/complete")
      .send({
        ...testCredentials,
        token: await registrationToken(),
        password: "short",
      })
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
      .post("/auth/register/complete")
      .send({
        ...testCredentials,
        token: await registrationToken(),
        name: "   ",
      })
      .expect(400);

    const error = apiErrorSchema.parse(response.body);

    expect(error.errors).toEqual([
      expect.objectContaining({ path: ["name"], code: "NAME_REQUIRED" }),
    ]);
  });

  it("rejects a name with no letter in it, however long", async () => {
    const response = await request(server)
      .post("/auth/register/complete")
      .send({
        ...testCredentials,
        token: await registrationToken(),
        name: "\u200b\u200b\u200b",
      })
      .expect(400);

    const error = apiErrorSchema.parse(response.body);

    expect(error.errors).toEqual([expect.objectContaining({ path: ["name"] })]);
  });

  it("preserves the delivery address while matching the account case-insensitively", async () => {
    const email = "E2E@MAIL.TEST";
    await request(server)
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: await registrationToken(email) })
      .expect(201);

    const response = await request(server)
      .post("/auth/login")
      .send(testCredentials)
      .expect(200);
    expect(userSchema.parse(response.body).email).toBe("E2E@mail.test");
  });

  it("reuses sign-up links only for the same spelling of the delivery address", async () => {
    const firstEmail = "E2E@mail.test";
    await registrationToken(firstEmail);
    const { email } = testCredentials;
    for (let attempt = 0; attempt < 2; attempt++) {
      await request(server).post("/auth/register").send({ email }).expect(202);
    }

    const db = app.get(PrismaService);
    const links = await db.accountMail.findMany({
      where: { kind: "register" },
    });
    expect(links.map(({ email }) => email).sort()).toEqual([
      firstEmail,
      testCredentials.email,
    ]);
    const correctedLink = links.find((link) => link.email === email);
    if (!correctedLink) throw new Error("Missing corrected sign-up letter");
    await waitUntil(async () => {
      const link = await db.accountMail.findUnique({
        where: { id: correctedLink.id },
      });
      return link?.expiresAt != null;
    });
    const response = await request(server)
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: accountMailToken(correctedLink.id) })
      .expect(201);
    expect(userSchema.parse(response.body).email).toBe(testCredentials.email);
    expect(await db.accountMail.count({ where: { kind: "register" } })).toBe(0);
  });

  it("refuses a reset link for an example address, whether or not an account holds it", async () => {
    const { name, email: held } = hostCredentials;
    await app
      .get(PrismaService)
      .user.create({ data: { name, email: held, passwordHash: "unused" } });
    const answers = await Promise.all(
      [held, "nobody@example.net"].map((email) =>
        request(server)
          .post("/auth/password/reset/request")
          .send({ email })
          .expect(400),
      ),
    );
    for (const answer of answers) {
      expect(issueCodesOf(answer)).toEqual(["EMAIL_RECEIVES_NO_MAIL"]);
    }
    expect(answers[0]?.text).toBe(answers[1]?.text);
    expect(
      await app.get(PrismaService).accountMail.count({
        where: { kind: "reset" },
      }),
    ).toBe(0);
  });

  it("resets a verified account once and ends its access and refresh sessions", async () => {
    const agent = request.agent(server);
    await agent
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: await registrationToken() })
      .expect(201);

    const unknown = await request(server)
      .post("/auth/password/reset/request")
      .send({ email: "unknown@mail.test" })
      .expect(202);
    const known = await request(server)
      .post("/auth/password/reset/request")
      .send({ email: testCredentials.email.toUpperCase() })
      .expect(202);
    expect(known.text).toBe(unknown.text);

    const db = app.get(PrismaService);
    const pending = await sentLink("reset", testCredentials.email);
    expect(pending.email).toBe(testCredentials.email);
    const token = accountMailToken(pending.id);
    const password = "a-different-password";
    const other = await signIn(app, fixtureCredentials);
    await endsEventStream(async () => {
      const response = await other
        .post("/auth/password/reset/complete")
        .send({ token, password })
        .expect(204);
      expect(readSetCookie(response, ACCESS_TOKEN_COOKIE)).toBeNull();
      expect(readSetCookie(response, REFRESH_TOKEN_COOKIE)).toBeNull();
    });
    await other.get("/auth/me").expect(200);
    await other.post("/auth/refresh").expect(200);
    await request(server)
      .post("/auth/password/reset/complete")
      .send({ token, password })
      .expect(400);
    await agent.get("/auth/me").expect(401);
    await agent.post("/auth/refresh").expect(401);
    await request(server).post("/auth/login").send(testCredentials).expect(401);
    await request(server)
      .post("/auth/login")
      .send({ email: testCredentials.email, password })
      .expect(200);
    expect(
      await db.accountMail.count({
        where: { kind: "passwordChanged", email: testCredentials.email },
      }),
    ).toBe(1);
  });

  it("requires the current password and confirmation before replacing the email address", async () => {
    const agent = request.agent(server);
    await agent
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: await registrationToken() })
      .expect(201);

    const email = "New+address@mail.test";
    await agent
      .post("/auth/email/change/request")
      .send({ email, password: "incorrect" })
      .expect(403);
    const supersededEmail = "previous-request@mail.test";
    await agent
      .post("/auth/email/change/request")
      .send({ email: supersededEmail, password: testCredentials.password })
      .expect(202);
    const superseded = await sentLink("change", supersededEmail);
    await agent
      .post("/auth/email/change/request")
      .send({ email, password: testCredentials.password })
      .expect(202);
    const revoked = await request(server)
      .post("/auth/email/change/complete")
      .send({ token: accountMailToken(superseded.id) })
      .expect(400);
    expect(apiErrorSchema.parse(revoked.body).code).toBe(
      "ACCOUNT_LINK_INVALID",
    );
    const current = await agent.get("/auth/me").expect(200);
    expect(userSchema.parse(current.body).email).toBe(testCredentials.email);

    const db = app.get(PrismaService);
    const pending = await sentLink("change", email);
    const token = accountMailToken(pending.id);
    await endsEventStream(async () => {
      const response = await agent
        .post("/auth/email/change/complete")
        .send({ token })
        .expect(204);
      expect(readSetCookie(response, ACCESS_TOKEN_COOKIE)).toBe("");
      expect(readSetCookie(response, REFRESH_TOKEN_COOKIE)).toBe("");
    });
    await request(server)
      .post("/auth/email/change/complete")
      .send({ token })
      .expect(400);
    await agent.get("/auth/me").expect(401);
    await agent.post("/auth/refresh").expect(401);
    await request(server).post("/auth/login").send(testCredentials).expect(401);
    const signedIn = await request(server)
      .post("/auth/login")
      .send({ email, password: testCredentials.password })
      .expect(200);
    expect(userSchema.parse(signedIn.body).email).toBe(email);
    expect(
      await db.accountMail.count({
        where: { kind: "emailChanged", email: testCredentials.email },
      }),
    ).toBe(1);
  });

  it("refuses new email-change requests and previously issued links for the demo admin", async () => {
    const credentials = {
      ...fixtureCredentials,
      email: DEMO_ACCOUNT_EMAILS.admin,
    };
    const agent = await signInAs(app, "ADMIN", credentials);
    const email = "another-address@mail.test";
    await agent
      .post("/auth/email/change/request")
      .send({ email, password: credentials.password })
      .expect(403);
    const db = app.get(PrismaService);
    expect(await db.accountMail.count({ where: { kind: "change" } })).toBe(0);

    const { id: userId, sessionVersion } = await db.user.findUniqueOrThrow({
      where: { email: credentials.email },
    });
    const id = randomUUID();
    const token = accountMailToken(id);
    await db.accountMail.create({
      data: {
        id,
        kind: "change",
        email,
        userId,
        sessionVersion,
        tokenHash: hashMailToken(token),
        expiresAt: addHours(new Date(), 24),
      },
    });
    await request(server)
      .post("/auth/email/change/complete")
      .send({ token })
      .expect(400);
    const current = await agent.get("/auth/me").expect(200);
    expect(userSchema.parse(current.body).email).toBe(credentials.email);
  });

  it("answers a wrong password with 401 and the same message as an unknown email", async () => {
    await request(server)
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: await registrationToken() })
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

    const agent = await signIn(app, testCredentials);
    const response = await agent.get("/auth/me").expect(200);

    expect(userSchema.parse(response.body).email).toBe(testCredentials.email);
  });

  it("closes /bookings too — the guard is global, not per-controller", async () => {
    await request(server).get("/bookings").expect(401);
  });

  it("rotates the refresh token: the previous one stops working", async () => {
    const agent = request.agent(server);
    const registered = await agent
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: await registrationToken() })
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
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: await registrationToken() })
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
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: await registrationToken() })
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
    const agent = await signIn(app, testCredentials);

    await app
      .get(PrismaService)
      .user.delete({ where: { email: testCredentials.email } });

    const refused = await agent.get("/auth/me").expect(401);

    expect(apiErrorSchema.parse(refused.body).code).toBe("SESSION_NOT_FOUND");
  });

  it("tells a blocked account so only once the password is right", async () => {
    await request(server)
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: await registrationToken() })
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
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: await registrationToken() })
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
    const agent = await signIn(app, testCredentials);

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
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: await registrationToken() })
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
      .post("/auth/register/complete")
      .send({ ...testCredentials, token: await registrationToken() })
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
