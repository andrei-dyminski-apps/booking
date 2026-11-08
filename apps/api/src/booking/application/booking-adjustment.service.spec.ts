import { randomUUID } from "node:crypto";
import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  BookingStatus,
  DisputeStatus,
  RefundFailureStatus,
  type AdminRefundInput,
} from "@repo/contracts";
import { cents, subtractCents } from "../../payment/domain/money";
import type { BookingWithListingOwner } from "../domain/booking.types";
import {
  adjustmentKey,
  type BookingAdjustmentService,
} from "./booking-adjustment.service";
import type { BookingPaymentHandler } from "./booking-payment.handler";
import type { BookingService } from "./booking.service";
import { createBookingTestbed, payForStay } from "./testing/booking.fakes";
import { type FakeBookingAdjustmentRepository } from "./testing/booking-adjustment-repository.fakes";
import { type FakeBookingCancellationRepository } from "./testing/booking-cancellation-repository.fakes";
import {
  admin,
  AMOUNT,
  GUEST_ID,
  input,
} from "./testing/booking-fixtures.fakes";
import { type FakeBookingTable } from "./testing/booking-table.fakes";
import {
  refundIdOf,
  type FakePaymentGateway,
} from "./testing/payment-gateway.fakes";

const PART = cents(10_000);

/**
 * An admin's partial refund against fakes of its repositories and the gateway — see
 * `testing/booking.fakes.ts`. What Stripe answers to the keys and the amounts is
 * `stripe-payment.gateway.spec.ts`'s; the same rules against the real database and the
 * payout are `test/payment.e2e-spec.ts`'s.
 */
describe("BookingAdjustmentService", () => {
  let service: BookingService;
  let adjustmentService: BookingAdjustmentService;
  let paymentHandler: BookingPaymentHandler;
  let bookingTable: FakeBookingTable;
  let bookingCancellationRepository: FakeBookingCancellationRepository;
  let bookingAdjustmentRepository: FakeBookingAdjustmentRepository;
  let paymentGateway: FakePaymentGateway;

  /** A stay `guest` has paid for, starting `days` from today — `0` is under way. */
  const paidStay = (days: number): Promise<string> =>
    payForStay({ service, paymentHandler }, days);

  const rowOf = (id: string): BookingWithListingOwner => {
    const found = bookingTable.rows.get(id);

    if (found === undefined) throw new Error(`Booking ${id} was not stored`);

    return found;
  };

  const paymentOf = (id: string): string => {
    const { paymentId } = rowOf(id);

    if (paymentId === null) throw new Error(`Booking ${id} was not paid`);

    return paymentId;
  };

  const press = (amount: number = PART): AdminRefundInput => ({
    amountCents: cents(amount),
    reason: "The hot water was off for two nights",
    requestId: randomUUID(),
  });

  /** The provider's news of the stay's refund total, as `charge.refunded` brings it. */
  const reportRefunded = (id: string, total: number) =>
    paymentHandler.handle({
      kind: "refunded",
      eventId: `evt_refunded_${id}_${String(total)}`,
      type: "charge.refunded",
      paymentId: paymentOf(id),
      chargeId: `ch_${id}`,
      amountRefunded: cents(total),
    });

  beforeEach(async () => {
    ({
      service,
      adjustmentService,
      paymentHandler,
      bookingTable,
      bookingCancellationRepository,
      bookingAdjustmentRepository,
      paymentGateway,
    } = await createBookingTestbed());
  });

  it("refunds part of a stay once per press and leaves the stay and its total alone", async () => {
    const id = await paidStay(5);
    const body = press();
    const key = adjustmentKey(id, body.requestId);

    const first = await adjustmentService.refund(id, admin, body);

    expect(first).toMatchObject({
      bookingId: id,
      amountCents: PART,
      reason: body.reason,
      refundId: refundIdOf(key),
      admin: { id: admin.id },
    });
    expect(await adjustmentService.refund(id, admin, body)).toEqual(first);
    expect([...paymentGateway.refunds]).toEqual([
      [key, { paymentId: paymentOf(id), amount: PART }],
    ]);
    // One read of the payment's refunds before the refund; the second press is the record's.
    expect(paymentGateway.looked).toEqual([key]);
    // The total is the provider's news to raise, and only a cancellation moves the status.
    expect(rowOf(id).booking).toMatchObject({
      status: BookingStatus.CONFIRMED,
      refundedAmountCents: null,
    });
  });

  it("keeps the last cent of a stay not yet begun, so its refund never cancels it", async () => {
    const id = await paidStay(5);

    await expect(
      adjustmentService.refund(id, admin, press(AMOUNT)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(paymentGateway.refunds.size).toBe(0);

    await adjustmentService.refund(id, admin, press(AMOUNT - 1));
    await reportRefunded(id, AMOUNT - 1);

    expect(rowOf(id).booking).toMatchObject({
      status: BookingStatus.CONFIRMED,
      refundedAmountCents: AMOUNT - 1,
    });
  });

  it("counts a refund whose webhook is late, so two presses cannot give back all of a stay not yet begun", async () => {
    const id = await paidStay(5);

    await adjustmentService.refund(id, admin, press());

    // The record still says nothing went back; the provider says PART did.
    await expect(
      adjustmentService.refund(id, admin, press(AMOUNT - PART)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(paymentGateway.refunds.size).toBe(1);
    expect(bookingAdjustmentRepository.rows).toHaveLength(1);

    await adjustmentService.refund(id, admin, press(AMOUNT - PART - 1));
    await reportRefunded(id, AMOUNT - 1);

    expect(rowOf(id).booking).toMatchObject({
      status: BookingStatus.CONFIRMED,
      refundedAmountCents: AMOUNT - 1,
    });
  });

  it("gives back all that is left of a stay under way", async () => {
    const id = await paidStay(0);

    await expect(
      adjustmentService.refund(id, admin, press(AMOUNT)),
    ).resolves.toMatchObject({ amountCents: AMOUNT });
  });

  it("measures a press against what went back and what a cancellation still owes", async () => {
    const id = await paidStay(0);

    rowOf(id).booking.refundedAmountCents = PART;
    rowOf(id).booking.refundOwedCents = PART;

    const left = subtractCents(AMOUNT, cents(PART * 2));

    await expect(
      adjustmentService.refund(id, admin, press(left + 1)),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      adjustmentService.refund(id, admin, press(left)),
    ).resolves.toMatchObject({ amountCents: left });
  });

  it("keeps the amount of a press whose answer was lost, and records its refund when pressed again", async () => {
    const id = await paidStay(5);
    const body = press();
    const key = adjustmentKey(id, body.requestId);

    paymentGateway.losingAnswers = true;

    await expect(
      adjustmentService.refund(id, admin, body),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(bookingAdjustmentRepository.rows).toMatchObject([
      { requestId: body.requestId, amountCents: PART, refundId: null },
    ]);
    // Claimed but not sent as far as anyone knows: listed as such, so it can be finished
    // after the dialog is gone.
    expect(await adjustmentService.listOf(id)).toMatchObject([
      { requestId: body.requestId, amountCents: PART, refundId: null },
    ]);

    paymentGateway.losingAnswers = false;

    // Another amount under the same press would be a second refund.
    await expect(
      adjustmentService.refund(id, admin, { ...body, amountCents: cents(500) }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      adjustmentService.refund(id, admin, body),
    ).resolves.toMatchObject({ amountCents: PART, refundId: refundIdOf(key) });
    expect(paymentGateway.refunds.size).toBe(1);
    expect(bookingAdjustmentRepository.rows).toMatchObject([
      { requestId: body.requestId, refundId: refundIdOf(key) },
    ]);
  });

  it("records a press whose answer was lost before refusing it, without measuring it again", async () => {
    const id = await paidStay(5);
    const body = press();
    const key = adjustmentKey(id, body.requestId);

    paymentGateway.losingAnswers = true;
    await expect(
      adjustmentService.refund(id, admin, body),
    ).rejects.toBeInstanceOf(BadGatewayException);
    paymentGateway.losingAnswers = false;

    // Since then the webhook raised the total and the bank opened a dispute: a new press
    // would be refused on both counts, and the provider refuses anything more.
    rowOf(id).booking.refundedAmountCents = subtractCents(AMOUNT, cents(1));
    rowOf(id).booking.dispute = DisputeStatus.OPEN;
    paymentGateway.exceeding = true;

    await expect(
      adjustmentService.refund(id, admin, body),
    ).resolves.toMatchObject({ amountCents: PART, refundId: refundIdOf(key) });
    expect(paymentGateway.refunds.size).toBe(1);
    expect(bookingAdjustmentRepository.rows).toHaveLength(1);
  });

  it("sends a claimed press the provider never received under the same key, or lets it go when the stay refuses it", async () => {
    const id = await paidStay(5);
    const body = press();
    const key = adjustmentKey(id, body.requestId);
    const claim = {
      bookingId: id,
      adminId: admin.id,
      requestId: body.requestId,
      amountCents: PART,
      currency: rowOf(id).booking.currency,
      reason: body.reason,
    };

    await bookingAdjustmentRepository.claim(claim);

    await expect(
      adjustmentService.refund(id, admin, body),
    ).resolves.toMatchObject({ amountCents: PART, refundId: refundIdOf(key) });
    expect([...paymentGateway.refunds.keys()]).toEqual([key]);

    const refused = press();

    await bookingAdjustmentRepository.claim({
      ...claim,
      requestId: refused.requestId,
    });
    rowOf(id).booking.dispute = DisputeStatus.OPEN;

    // A minute old at most, its own request may still land at Stripe: the claim stays.
    await expect(adjustmentService.refund(id, admin, refused)).rejects.toThrow(
      /may still be reaching Stripe/,
    );
    expect(bookingAdjustmentRepository.rows).toHaveLength(2);

    const [, young] = bookingAdjustmentRepository.rows;

    if (young === undefined) throw new Error("The claim was not stored");

    young.attemptedAt = new Date(Date.now() - 61_000).toISOString();

    await expect(adjustmentService.refund(id, admin, refused)).rejects.toThrow(
      /disputed/,
    );
    // Nothing went out for it, so the claim goes: the press may name another amount now.
    expect(
      bookingAdjustmentRepository.rows.map((row) => row.requestId),
    ).toEqual([body.requestId]);
  });

  it("lets a claim go on Stripe's own refusal, however young: Stripe answered under its key", async () => {
    const id = await paidStay(5);
    const body = press();

    paymentGateway.losingAnswers = true;
    await expect(
      adjustmentService.refund(id, admin, body),
    ).rejects.toBeInstanceOf(BadGatewayException);
    paymentGateway.losingAnswers = false;
    // The refund never went out after all, and Stripe refuses it now: a dispute opened
    // before its webhook arrived.
    paymentGateway.refunds.clear();
    paymentGateway.refusingRefund =
      "Charge ch_spec has been charged back; cannot issue a refund.";

    await expect(adjustmentService.refund(id, admin, body)).rejects.toThrow(
      "Stripe refused the refund: Charge ch_spec has been charged back; cannot issue a refund.",
    );
    expect(bookingAdjustmentRepository.rows).toEqual([]);
  });

  it("waits a minute from the last request a press sent, not from its claim, before the record lets it go", async () => {
    const id = await paidStay(5);
    const body = press();

    paymentGateway.losingAnswers = true;
    await expect(
      adjustmentService.refund(id, admin, body),
    ).rejects.toBeInstanceOf(BadGatewayException);
    // The first request never reached Stripe, and the claim is long past its minute.
    paymentGateway.refunds.clear();

    const [claimed] = bookingAdjustmentRepository.rows;

    if (claimed === undefined) throw new Error("The claim was not stored");

    claimed.attemptedAt = new Date(Date.now() - 61_000).toISOString();
    claimed.createdAt = claimed.attemptedAt;

    // Pressed again: a request of its own goes out, and its answer is lost too — Stripe has
    // not carried it out yet, so the next read finds nothing.
    await expect(
      adjustmentService.refund(id, admin, body),
    ).rejects.toBeInstanceOf(BadGatewayException);
    paymentGateway.refunds.clear();
    paymentGateway.losingAnswers = false;
    rowOf(id).booking.dispute = DisputeStatus.OPEN;

    // That request may still land, so the claim stays although it was made over a minute ago.
    await expect(adjustmentService.refund(id, admin, body)).rejects.toThrow(
      /may still be reaching Stripe/,
    );
    expect(bookingAdjustmentRepository.rows).toMatchObject([
      { requestId: body.requestId, refundId: null },
    ]);
  });

  it("refuses a disputed payment and a stay nobody paid for before the provider is asked", async () => {
    const disputed = await paidStay(5);

    rowOf(disputed).booking.dispute = DisputeStatus.OPEN;

    await expect(
      adjustmentService.refund(disputed, admin, press()),
    ).rejects.toBeInstanceOf(ConflictException);

    const unpaid = (await service.create(GUEST_ID, input)).id;

    await expect(
      adjustmentService.refund(unpaid, admin, press()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(paymentGateway.looked).toEqual([]);
    expect(paymentGateway.refunds.size).toBe(0);
    expect(bookingAdjustmentRepository.rows).toEqual([]);
  });

  it("answers the provider's refusal of more than it holds with a 409, and a lower amount goes", async () => {
    const id = await paidStay(5);
    const body = press();

    paymentGateway.exceeding = true;

    await expect(
      adjustmentService.refund(id, admin, body),
    ).rejects.toBeInstanceOf(ConflictException);
    // Nothing went out, so the press holds no claim on its amount.
    expect(bookingAdjustmentRepository.rows).toEqual([]);

    paymentGateway.exceeding = false;

    await expect(
      adjustmentService.refund(id, admin, { ...body, amountCents: cents(500) }),
    ).resolves.toMatchObject({ amountCents: 500 });
  });

  it("answers a provider that cannot be reached with a 502, and the press again sends one refund", async () => {
    const id = await paidStay(5);
    const body = press();

    paymentGateway.refusing = true;

    await expect(
      adjustmentService.refund(id, admin, body),
    ).rejects.toBeInstanceOf(BadGatewayException);
    // The read failed before anything was claimed.
    expect(bookingAdjustmentRepository.rows).toEqual([]);

    paymentGateway.refusing = false;
    await adjustmentService.refund(id, admin, body);

    expect(paymentGateway.refunds.size).toBe(1);
  });

  it("settles the caller before the stay: a gone account is a 401, a demoted one a 403", async () => {
    const id = await paidStay(5);
    // The payment's own news took the stay's lease once.
    const leases = [...bookingCancellationRepository.leases];

    bookingAdjustmentRepository.standing = "GONE";
    await expect(
      adjustmentService.refund(id, admin, press()),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    bookingAdjustmentRepository.standing = "NOT_ADMIN";
    await expect(
      adjustmentService.refund(randomUUID(), admin, press()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(bookingCancellationRepository.leases).toEqual(leases);
    expect(paymentGateway.refunds.size).toBe(0);
  });

  it("is a 409 while another request holds the stay, and a 404 for one that is not there", async () => {
    const id = await paidStay(5);

    bookingCancellationRepository.held.add(id);
    bookingCancellationRepository.waits.length = 0;

    await expect(
      adjustmentService.refund(id, admin, press()),
    ).rejects.toBeInstanceOf(ConflictException);
    // A second of waiting rather than a cancellation's three: Stripe comes after it.
    expect(bookingCancellationRepository.waits).toEqual([1_000]);
    await expect(
      adjustmentService.refund(randomUUID(), admin, press()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(paymentGateway.refunds.size).toBe(0);
  });

  it("lists a stay's refunds newest first, a claim and what the bank sent back among them, and a stay that is not there is a 404", async () => {
    const id = await paidStay(0);
    const first = await adjustmentService.refund(id, admin, press());
    const second = await adjustmentService.refund(id, admin, press(500));
    const lost = press(700);

    paymentGateway.losingAnswers = true;
    await expect(
      adjustmentService.refund(id, admin, lost),
    ).rejects.toBeInstanceOf(BadGatewayException);

    if (first.refundId === null) throw new Error("The refund was not recorded");

    bookingAdjustmentRepository.bounces.set(
      first.refundId,
      RefundFailureStatus.OPEN,
    );

    expect(await adjustmentService.listOf(id)).toEqual([
      expect.objectContaining({
        requestId: lost.requestId,
        amountCents: 700,
        refundId: null,
        bounce: null,
      }),
      { ...second, bounce: null },
      { ...first, bounce: RefundFailureStatus.OPEN },
    ]);
    await expect(adjustmentService.listOf(randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
