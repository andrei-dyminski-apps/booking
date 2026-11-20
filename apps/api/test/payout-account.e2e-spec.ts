import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { App } from "supertest/types";
import {
  HostAccountStatus,
  Role,
  accountSessionSchema,
  hostAccountSchema,
  payoutCountriesSchema,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { PayoutGateway } from "./../src/payout/application/ports/payout-gateway";
import { FakePayoutGateway } from "./../src/payout/application/testing/payout-gateway.fakes";
import { PrismaService } from "./../src/prisma/prisma.service";
import { hasCode, issueCodesOf } from "./api-error";
import { resetDatabase } from "./database";
import { resetQueue } from "./queue";
import { credentialsFor, signInAs, type Agent } from "./session";
import { waitUntil } from "./wait-until";

/**
 * The payout account's routes over HTTP, against the real database: the global pipe
 * parsing the body by the contract, the guard's role, the error filter's codes, and the
 * conditional write into `users.stripe_account_id`. Stripe is the unit specs' fake, which
 * lists DE, GB, PL and US and records what it opened and closed.
 */
describe("PayoutAccountController (e2e)", () => {
  let app: INestApplication<App>;
  let gateway: FakePayoutGateway;
  let host: Agent;

  beforeEach(async () => {
    gateway = new FakePayoutGateway();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PayoutGateway)
      .useValue(gateway)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    await resetDatabase(app);
    await resetQueue(app);

    host = await signInAs(app, Role.USER);
  });

  afterEach(async () => {
    await app.close();
  });

  /** What the column holds, which only the conditional write fills. */
  const attachedAccount = async (): Promise<string | null> =>
    (
      await app.get(PrismaService).user.findUniqueOrThrow({
        where: { email: credentialsFor[Role.USER].email },
        select: { stripeAccountId: true },
      })
    ).stripeAccountId;

  it("lists the countries Stripe offers", async () => {
    const response = await host.get("/payouts/account/countries").expect(200);

    expect(payoutCountriesSchema.parse(response.body)).toEqual({
      countries: ["DE", "GB", "PL", "US"],
    });
  });

  it("refuses a session before the account is opened, since the country comes first", async () => {
    await host
      .post("/payouts/account/session")
      .expect(409)
      .expect(hasCode("PAYOUT_ACCOUNT_NOT_OPENED"));
    expect(gateway.accounts).toHaveLength(0);
  });

  it("refuses a body with no country, or one not spelled as Stripe spells it, in the contract's code", async () => {
    for (const body of [{}, { country: "pl" }, { country: "POL" }]) {
      const response = await host
        .post("/payouts/account")
        .send(body)
        .expect(400)
        .expect(hasCode("VALIDATION_FAILED"));

      expect(issueCodesOf(response)).toEqual(["PAYOUT_COUNTRY_UNSUPPORTED"]);
    }

    expect(gateway.accounts).toHaveLength(0);
  });

  it("refuses a well-formed country Stripe's list leaves out under the same code, opening nothing", async () => {
    await host
      .post("/payouts/account")
      .send({ country: "FR" })
      .expect(400)
      .expect(hasCode("PAYOUT_COUNTRY_UNSUPPORTED"));

    expect(gateway.accounts).toHaveLength(0);
    expect(await attachedAccount()).toBeNull();
  });

  it("opens the account in the country picked, writes it down, and answers the same account to a second pick", async () => {
    gateway.openedIds = ["acct_first", "acct_second"];

    const opened = await host
      .post("/payouts/account")
      .send({ country: "PL" })
      .expect(200);

    expect(hostAccountSchema.parse(opened.body)).toEqual({
      status: HostAccountStatus.ONBOARDING,
    });
    expect(await attachedAccount()).toBe("acct_first");
    expect(gateway.accounts.map((account) => account.country)).toEqual(["PL"]);

    // Stripe fixes the country at opening: another pick is answered as the account stands.
    await host.post("/payouts/account").send({ country: "DE" }).expect(200);

    expect(gateway.accounts).toHaveLength(1);
    expect(await attachedAccount()).toBe("acct_first");

    const read = await host.get("/payouts/account").expect(200);

    expect(hostAccountSchema.parse(read.body).status).toBe(
      HostAccountStatus.ONBOARDING,
    );

    const session = await host.post("/payouts/account/session").expect(200);

    expect(accountSessionSchema.parse(session.body)).toEqual({
      clientSecret: "acct_first_session",
    });
  });

  it("keeps one account open however two opens with different countries interleave: the one attached", async () => {
    gateway.openedIds = ["acct_first", "acct_second"];

    await Promise.all([
      host.post("/payouts/account").send({ country: "PL" }).expect(200),
      host.post("/payouts/account").send({ country: "DE" }).expect(200),
    ]);

    // Either the second request saw the first's account and opened none, or both reached
    // Stripe and the one that lost the column queued a `close-account` job for its own,
    // which the worker runs after the answer.
    await waitUntil(() =>
      Promise.resolve(gateway.accounts.length - gateway.closed.length === 1),
    );

    const attached = await attachedAccount();

    expect(attached).not.toBeNull();
    expect(gateway.closed).not.toContain(attached);
  });

  it("answers an admin 403: an admin hosts nothing", async () => {
    const admin = await signInAs(app, Role.ADMIN);

    await admin.get("/payouts/account/countries").expect(403);
    await admin.post("/payouts/account").send({ country: "PL" }).expect(403);
  });
});
