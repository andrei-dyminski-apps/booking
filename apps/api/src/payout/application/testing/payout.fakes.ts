import { Test } from "@nestjs/testing";
import { BookingStatus } from "@repo/contracts";
import { NotificationService } from "../../../notification/notification.service";
import { FakeNotificationService } from "../../../notification/testing/notification-service.fakes";
import { CURRENCY, NO_CENTS } from "../../../payment/domain/money";
import { PayoutRepository } from "../../infrastructure/payout.repository";
import { HostAccountService } from "../host-account.service";
import { PayoutService } from "../payout.service";
import { PayoutGateway } from "../ports/payout-gateway";
import { PayoutJobs } from "../ports/payout-jobs";
import {
  AMOUNT,
  BOOKING_ID,
  CHARGE_ID,
  GUEST_ID,
  host,
  HOST_ID,
  LISTING_ID,
  PAYMENT_ID,
  type StoredStay,
} from "./payout-fixtures.fakes";
import { FakePayoutGateway } from "./payout-gateway.fakes";
import { FakePayoutJobs } from "./payout-jobs.fakes";
import { FakePayoutRepository } from "./payout-repository.fakes";

/*
 * The module `payout.service.spec.ts` and `host-account.service.spec.ts` build their classes
 * in — one module, because an account switched on or off decides what the payouts send. The
 * fixtures and the fakes of everything around the two classes are the files beside this
 * one, one per port — the notifications' is `notification/testing/`'s, shared with the
 * booking specs. Kept out of the build by `tsconfig.build.json` (`*.fakes.ts`).
 */

/** The payout module over the fakes, as the specs build it before each test. */
export type PayoutTestbed = {
  service: PayoutService;
  hostAccountService: HostAccountService;
  payoutRepository: FakePayoutRepository;
  payoutGateway: FakePayoutGateway;
  payoutJobs: FakePayoutJobs;
  notificationService: FakeNotificationService;
};

export async function createPayoutTestbed(): Promise<PayoutTestbed> {
  const payoutRepository = new FakePayoutRepository();
  const payoutGateway = new FakePayoutGateway();
  const payoutJobs = new FakePayoutJobs();
  const notificationService = new FakeNotificationService();

  const moduleRef = await Test.createTestingModule({
    providers: [
      PayoutService,
      HostAccountService,
      { provide: PayoutRepository, useValue: payoutRepository },
      { provide: PayoutGateway, useValue: payoutGateway },
      { provide: PayoutJobs, useValue: payoutJobs },
      { provide: NotificationService, useValue: notificationService },
    ],
  }).compile();

  return {
    service: moduleRef.get(PayoutService),
    hostAccountService: moduleRef.get(HostAccountService),
    payoutRepository,
    payoutGateway,
    payoutJobs,
    notificationService,
  };
}

/** A stay `GUEST_ID` paid for at a listing `HOST_ID` owns, checking in on `from`. */
export function storePaidStay(
  payoutRepository: FakePayoutRepository,
  from: string,
  overrides: Partial<StoredStay> = {},
): void {
  payoutRepository.stays.set(BOOKING_ID, {
    bookingId: BOOKING_ID,
    status: BookingStatus.CONFIRMED,
    amountCents: AMOUNT,
    currency: CURRENCY,
    refundedAmountCents: null,
    refundOwedCents: null,
    paid: true,
    disputeStatus: null,
    chargeId: CHARGE_ID,
    transferId: null,
    paidOutAmountCents: null,
    payoutReservedCents: null,
    payoutReservations: 0,
    feeWithheldCents: NO_CENTS,
    paymentId: PAYMENT_ID,
    hold: {
      stay: {
        bookingId: BOOKING_ID,
        listingId: LISTING_ID,
        listingTitle: "Loft above the harbour",
        from,
        to: "2099-12-31",
      },
      guestId: GUEST_ID,
      listingOwnerId: HOST_ID,
      paymentId: PAYMENT_ID,
    },
    ...overrides,
  });
}

/** `HOST_ID` with a payout account `accountId`, able to receive transfers or not. */
export function storeHost(
  payoutRepository: FakePayoutRepository,
  accountId: string | null,
  enabled: boolean,
): void {
  payoutRepository.holders.set(HOST_ID, {
    email: host.email,
    name: "Harbour Host",
    accountId,
    enabled,
  });
}
