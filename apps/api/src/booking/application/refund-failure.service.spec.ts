import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { refundFailureQuerySchema } from "@repo/contracts";
import { CURRENCY, cents } from "../../payment/domain/money";
import { RefundFailureRepository } from "../infrastructure/refund-failure.repository";
import { RefundFailureService } from "./refund-failure.service";
import { FakeRefundFailureRepository } from "./testing/booking.fakes";

/** A query as it reaches the service, parsed by the contract so its defaults are the API's. */
const query = (search: Record<string, string> = {}) =>
  refundFailureQuerySchema.parse(search);

describe("RefundFailureService", () => {
  let service: RefundFailureService;
  let refundFailureRepository: FakeRefundFailureRepository;

  /** A refund the bank sent back, as the payment handler records it. */
  const bounced = (refundId: string) =>
    refundFailureRepository.record({
      refundId,
      paymentId: "pi_1",
      bookingId: null,
      amountCents: cents(10_000),
      currency: CURRENCY,
      reason: "expired_or_canceled_card",
    });

  beforeEach(async () => {
    refundFailureRepository = new FakeRefundFailureRepository();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RefundFailureService,
        {
          provide: RefundFailureRepository,
          useValue: refundFailureRepository,
        },
      ],
    }).compile();

    service = moduleRef.get(RefundFailureService);
  });

  it("lists the open failures by default, in cents like every amount the contract carries", async () => {
    await bounced("re_1");

    await expect(service.findPage(query())).resolves.toEqual({
      items: [
        expect.objectContaining({
          refundId: "re_1",
          amountCents: 10_000,
          resolvedAt: null,
          resolution: null,
        }),
      ],
      nextCursor: null,
    });
  });

  it("moves a resolved failure to the other list, with how the money went back", async () => {
    await bounced("re_1");
    await bounced("re_2");

    await service.resolve("re_1", { resolution: "Sent by bank transfer" });

    const open = await service.findPage(query());
    const resolved = await service.findPage(query({ status: "RESOLVED" }));

    expect(open.items.map(({ refundId }) => refundId)).toEqual(["re_2"]);
    expect(resolved.items).toEqual([
      expect.objectContaining({
        refundId: "re_1",
        resolution: "Sent by bank transfer",
      }),
    ]);
  });

  it("keeps the first resolution, and refuses one of a refund that never came back", async () => {
    await bounced("re_1");
    await service.resolve("re_1", { resolution: "Sent by bank transfer" });

    await expect(
      service.resolve("re_1", { resolution: "Paid in cash" }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.resolve("re_unknown", { resolution: "Paid in cash" }),
    ).rejects.toThrow(NotFoundException);
    expect(refundFailureRepository.resolutions.get("re_1")).toBe(
      "Sent by bank transfer",
    );
  });

  it("pages newest first, and refuses a cursor of the other list", async () => {
    await bounced("re_1");
    await bounced("re_2");

    const first = await service.findPage(query({ limit: "1" }));
    const cursor = first.nextCursor ?? "";
    const second = await service.findPage(query({ limit: "1", cursor }));

    expect(first.items.map(({ refundId }) => refundId)).toEqual(["re_2"]);
    expect(second.items.map(({ refundId }) => refundId)).toEqual(["re_1"]);
    expect(second.nextCursor).toBeNull();
    await expect(
      service.findPage(query({ status: "RESOLVED", cursor })),
    ).rejects.toThrow(BadRequestException);
  });
});
