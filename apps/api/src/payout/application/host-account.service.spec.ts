import { BadGatewayException } from "@nestjs/common";
import { HostAccountStatus } from "@repo/contracts";
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

  it("opens the account on the first session and keeps it for the next", async () => {
    hostWith(null, false);

    await expect(hostAccountService.session(host)).resolves.toEqual({
      clientSecret: `${ACCOUNT_ID}_session`,
    });
    await hostAccountService.session(host);

    expect(payoutGateway.accounts).toEqual([
      { userId: HOST_ID, email: host.email, name: "Harbour Host" },
    ]);
    expect(payoutRepository.holders.get(HOST_ID)?.accountId).toBe(ACCOUNT_ID);
  });

  it("answers 502 for the provider's failure and leaves the database's its own", async () => {
    hostWith(null, false);
    payoutGateway.refusingSessions = true;

    await expect(hostAccountService.session(host)).rejects.toBeInstanceOf(
      BadGatewayException,
    );

    payoutGateway.refusingSessions = false;
    hostWith(null, false);
    payoutRepository.brokenAttach = true;

    const failure = hostAccountService.session(host);

    await expect(failure).rejects.toThrow("connection refused");
    await expect(failure).rejects.not.toBeInstanceOf(BadGatewayException);
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
