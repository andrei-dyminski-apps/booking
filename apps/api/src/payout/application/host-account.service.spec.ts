import { BadGatewayException } from "@nestjs/common";
import { HostAccountStatus } from "@repo/contracts";
import { refusalOf } from "../../common/testing/refusal";
import type { HostAccountService } from "./host-account.service";
import type { PayoutService } from "./payout.service";
import {
  ACCOUNT_ID,
  BOOKING_ID,
  host,
  HOST_ID,
  PAST,
  SHARE,
  type StoredStay,
} from "./testing/payout-fixtures.fakes";
import type { FakePayoutGateway } from "./testing/payout-gateway.fakes";
import type { FakePayoutJobs } from "./testing/payout-jobs.fakes";
import type { FakePayoutRepository } from "./testing/payout-repository.fakes";
import {
  createPayoutTestbed,
  storeHost,
  storePaidStay,
} from "./testing/payout.fakes";

/**
 * The host's payout account, against the fakes of `testing/`. Built in the same module as
 * `PayoutService`, since an account switched on is what lets the payouts that waited go.
 */
describe("HostAccountService", () => {
  let payoutService: PayoutService;
  let hostAccountService: HostAccountService;
  let payoutRepository: FakePayoutRepository;
  let payoutGateway: FakePayoutGateway;
  let payoutJobs: FakePayoutJobs;

  const paidStay = (from: string) => {
    storePaidStay(payoutRepository, from);
  };

  const hostWith = (accountId: string | null, enabled: boolean) => {
    storeHost(payoutRepository, accountId, enabled);
  };

  const stored = (): StoredStay | undefined =>
    payoutRepository.stays.get(BOOKING_ID);

  beforeEach(async () => {
    ({
      service: payoutService,
      hostAccountService,
      payoutRepository,
      payoutGateway,
      payoutJobs,
    } = await createPayoutTestbed());
  });

  it("answers NOT_STARTED to a host with no account, and opens none", async () => {
    hostWith(null, false);

    await expect(hostAccountService.account(host)).resolves.toEqual({
      status: HostAccountStatus.NOT_STARTED,
    });
    expect(payoutGateway.accounts).toEqual([]);
  });

  it("opens no session before the account, whose country comes first", async () => {
    hostWith(null, false);

    await expect(refusalOf(hostAccountService.session(host))).resolves.toEqual({
      status: 409,
      code: "PAYOUT_ACCOUNT_NOT_OPENED",
    });
    expect(payoutGateway.accounts).toEqual([]);
  });

  it("opens the account in the country picked, once, and a session for it", async () => {
    hostWith(null, false);

    await expect(hostAccountService.open(host, "PL")).resolves.toEqual({
      status: HostAccountStatus.ONBOARDING,
    });
    // Stripe fixed the country at opening; another pick opens nothing and changes nothing.
    await expect(hostAccountService.open(host, "DE")).resolves.toEqual({
      status: HostAccountStatus.ONBOARDING,
    });
    await expect(hostAccountService.session(host)).resolves.toEqual({
      clientSecret: `${ACCOUNT_ID}_session`,
    });

    expect(payoutGateway.accounts).toEqual([
      {
        userId: HOST_ID,
        email: host.email,
        name: "Harbour Host",
        country: "PL",
      },
    ]);
    expect(payoutRepository.holders.get(HOST_ID)?.accountId).toBe(ACCOUNT_ID);
  });

  it("answers 502 for the provider's failure and leaves the database's its own", async () => {
    hostWith(ACCOUNT_ID, false);
    payoutGateway.refusingSessions = true;

    await expect(refusalOf(hostAccountService.session(host))).resolves.toEqual({
      status: 502,
      code: "PAYOUT_ACCOUNT_UNAVAILABLE",
    });

    hostWith(null, false);
    payoutRepository.brokenAttach = true;

    const failure = hostAccountService.open(host, "PL");

    await expect(failure).rejects.toThrow("connection refused");
    await expect(failure).rejects.not.toBeInstanceOf(BadGatewayException);
  });

  it("answers 502 when Stripe cannot open the account, and attaches nothing", async () => {
    hostWith(null, false);
    payoutGateway.refusingAccounts = "outage";

    await expect(
      refusalOf(hostAccountService.open(host, "PL")),
    ).resolves.toEqual({ status: 502, code: "PAYOUT_ACCOUNT_UNAVAILABLE" });
    expect(payoutRepository.holders.get(HOST_ID)?.accountId).toBeNull();
  });

  it("answers 409, not 502, while another request is opening the account, and opens it on a retry", async () => {
    hostWith(null, false);
    payoutGateway.refusingAccounts = "inProgress";

    await expect(
      refusalOf(hostAccountService.open(host, "PL")),
    ).resolves.toEqual({ status: 409, code: "PAYOUT_ACCOUNT_BEING_OPENED" });
    expect(payoutRepository.holders.get(HOST_ID)?.accountId).toBeNull();

    await expect(hostAccountService.open(host, "PL")).resolves.toEqual({
      status: HostAccountStatus.ONBOARDING,
    });
    expect(payoutRepository.holders.get(HOST_ID)?.accountId).toBe(ACCOUNT_ID);
  });

  it("answers 400, not 502, for a country Stripe will not open an account in, and stops offering it", async () => {
    hostWith(null, false);
    payoutGateway.refusingAccounts = "country";

    await expect(
      refusalOf(hostAccountService.open(host, "PL")),
    ).resolves.toEqual({ status: 400, code: "PAYOUT_COUNTRY_UNSUPPORTED" });
    expect(payoutRepository.holders.get(HOST_ID)?.accountId).toBeNull();
    await expect(hostAccountService.countries(host)).resolves.toEqual({
      countries: ["DE", "GB", "US"],
    });

    // Another pick goes ahead as usual.
    await expect(hostAccountService.open(host, "DE")).resolves.toEqual({
      status: HostAccountStatus.ONBOARDING,
    });
  });

  it("closes the account a racing request with another country opened, and keeps the one attached", async () => {
    hostWith(null, false);
    payoutGateway.openedIds = ["acct_pl", "acct_de"];

    await expect(
      Promise.all([
        hostAccountService.open(host, "PL"),
        hostAccountService.open(host, "DE"),
      ]),
    ).resolves.toEqual([
      { status: HostAccountStatus.ONBOARDING },
      { status: HostAccountStatus.ONBOARDING },
    ]);
    expect(payoutRepository.holders.get(HOST_ID)?.accountId).toBe("acct_pl");
    // Queued rather than closed in the request, which Stripe's two calls would outlast.
    expect(payoutJobs.accountCloses).toEqual([
      { accountId: "acct_de", userId: HOST_ID, attached: "acct_pl" },
    ]);
    expect(payoutGateway.closed).toEqual([]);
  });

  it("closes nothing when a racing request with the same body is answered the same account", async () => {
    hostWith(null, false);

    await Promise.all([
      hostAccountService.open(host, "PL"),
      hostAccountService.open(host, "PL"),
    ]);

    expect(payoutRepository.holders.get(HOST_ID)?.accountId).toBe(ACCOUNT_ID);
    expect(payoutJobs.accountCloses).toEqual([]);
  });

  it("closes a queued account through Stripe, and fails the job for the queue to retry when Stripe will not", async () => {
    await hostAccountService.closeAccount({
      accountId: "acct_de",
      userId: HOST_ID,
      attached: "acct_pl",
    });

    expect(payoutGateway.closed).toEqual(["acct_de"]);

    payoutGateway.refusingClose = true;

    await expect(
      hostAccountService.closeAccount({
        accountId: "acct_pl",
        userId: HOST_ID,
        attached: "acct_de",
      }),
    ).rejects.toThrow("api_connection_error");
  });

  it("refuses a country Stripe's list leaves out before asking Stripe to open anything", async () => {
    hostWith(null, false);

    await expect(
      refusalOf(hostAccountService.open(host, "BR")),
    ).resolves.toEqual({ status: 400, code: "PAYOUT_COUNTRY_UNSUPPORTED" });

    payoutGateway.transferCountriesAnswer = null;

    await expect(
      refusalOf(hostAccountService.open(host, "PL")),
    ).resolves.toEqual({ status: 502, code: "PAYOUT_ACCOUNT_UNAVAILABLE" });
    await expect(
      refusalOf(hostAccountService.countries(host)),
    ).resolves.toEqual({ status: 502, code: "PAYOUT_ACCOUNT_UNAVAILABLE" });
    expect(payoutGateway.accounts).toEqual([]);
  });

  it("reads the account off the row without asking Stripe", async () => {
    // Stripe would say yes; the row has not heard it yet, and a read does not ask.
    payoutGateway.enabled = true;
    hostWith(ACCOUNT_ID, false);

    await expect(hostAccountService.account(host)).resolves.toEqual({
      status: HostAccountStatus.ONBOARDING,
    });
    expect(payoutRepository.holders.get(HOST_ID)?.enabled).toBe(false);
    expect(payoutJobs.hosts).toEqual([]);
  });

  it("asks Stripe about an unfinished account on a refresh, and queues what waited once it is done", async () => {
    payoutGateway.enabled = false;
    hostWith(ACCOUNT_ID, false);
    paidStay(PAST);

    await expect(hostAccountService.refresh(host)).resolves.toEqual({
      status: HostAccountStatus.ONBOARDING,
    });
    expect(payoutJobs.hosts).toEqual([]);

    payoutGateway.enabled = true;

    await expect(hostAccountService.refresh(host)).resolves.toEqual({
      status: HostAccountStatus.ENABLED,
    });
    await expect(hostAccountService.account(host)).resolves.toEqual({
      status: HostAccountStatus.ENABLED,
    });
    // Nothing is sent inside the request the dashboard waits on; the job pays it.
    expect(payoutGateway.transfers.size).toBe(0);
    expect(payoutJobs.hosts).toEqual([HOST_ID]);
    expect(payoutGateway.askedBy).toEqual(["request", "request"]);

    await payoutService.payDuePayouts(HOST_ID);

    expect(stored()?.paidOutAmountCents).toBe(SHARE);
  });
});
