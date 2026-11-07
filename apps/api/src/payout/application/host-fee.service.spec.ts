import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { HostFee } from "@repo/contracts";
import { isBefore, parseISO } from "date-fns";
import { cancellationsWindowStart } from "../../booking/infrastructure/booking.repository";
import type { PublicOf } from "../../common/testing/public-of.fakes";
import { cents, CURRENCY } from "../../payment/domain/money";
import {
  WaivingAccountGoneError,
  WaivingAccountNotAdminError,
} from "../domain/payout.errors";
import type { HostFeeReader } from "../domain/payout.types";
import { HostFeeRepository } from "../infrastructure/host-fee.repository";
import { HostFeeService } from "./host-fee.service";

const HOST_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
const ADMIN_ID = "8b1c2d3e-4f5a-4b6c-9d7e-0f1a2b3c4d5e";
const DEMOTED_ID = "9c2d3e4f-5a6b-4c7d-8e9f-1a2b3c4d5e6f";
const GONE_ID = "0d3e4f5a-6b7c-4d8e-9fa0-2b3c4d5e6f7a";
const NOW = new Date("2026-11-04T12:00:00.000Z");

/** The ledger in memory, with the cuts of the real one: owed, or written since. */
class FakeHostFeeRepository implements PublicOf<HostFeeRepository> {
  readonly fees: HostFee[] = [];
  /** The accounts a waiver may name, and whether each is still an active admin. */
  readonly accounts = new Map<string, { name: string; admin: boolean }>([
    [ADMIN_ID, { name: "Ada Admin", admin: true }],
    [DEMOTED_ID, { name: "Dan Demoted", admin: false }],
  ]);

  overviewOf(
    hostId: string,
    reader: HostFeeReader,
    now: Date,
  ): Promise<{ fees: HostFee[]; cancellationsInWindow: number }> {
    const since = cancellationsWindowStart(now);
    const recent = (fee: HostFee) => !isBefore(parseISO(fee.createdAt), since);
    const owed = (fee: HostFee) =>
      fee.waivedAt === null && fee.withheldCents < fee.amountCents;
    const ofHost = this.fees.filter((fee) => fee.hostId === hostId);

    return Promise.resolve({
      fees: ofHost
        .filter((fee) => recent(fee) || owed(fee))
        .map((fee) => ({
          ...fee,
          waivedBy: reader === "admin" ? fee.waivedBy : null,
        })),
      cancellationsInWindow: ofHost.filter(
        (fee) => recent(fee) && fee.waivedAt === null,
      ).length,
    });
  }

  waive(id: string, reason: string, adminId: string): Promise<boolean> {
    const account = this.accounts.get(adminId);

    if (account === undefined) {
      return Promise.reject(new WaivingAccountGoneError(adminId));
    }

    if (!account.admin) {
      return Promise.reject(new WaivingAccountNotAdminError(adminId));
    }

    const fee = this.fees.find((found) => found.id === id);

    if (fee === undefined) return Promise.resolve(false);

    if (fee.waivedAt !== null || fee.withheldCents >= fee.amountCents) {
      return Promise.resolve(false);
    }

    fee.waivedAt = NOW.toISOString();
    fee.waiveReason = reason;
    fee.waivedBy = { id: adminId, name: account.name };

    return Promise.resolve(true);
  }

  exists(id: string): Promise<boolean> {
    return Promise.resolve(this.fees.some((fee) => fee.id === id));
  }
}

describe("HostFeeService", () => {
  let service: HostFeeService;
  let hostFeeRepository: FakeHostFeeRepository;

  const fee = (id: string, overrides: Partial<HostFee> = {}): HostFee => {
    const written: HostFee = {
      id,
      bookingId: "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b",
      hostId: HOST_ID,
      listingTitle: "Loft above the harbour",
      from: "2026-12-01",
      to: "2026-12-04",
      amountCents: cents(10_000),
      withheldCents: cents(0),
      currency: CURRENCY,
      cancellationReason: "A pipe burst",
      waivedAt: null,
      waiveReason: null,
      waivedBy: null,
      createdAt: "2026-10-01T12:00:00.000Z",
      ...overrides,
    };

    hostFeeRepository.fees.push(written);

    return written;
  };

  beforeEach(async () => {
    hostFeeRepository = new FakeHostFeeRepository();

    const moduleRef = await Test.createTestingModule({
      providers: [
        HostFeeService,
        { provide: HostFeeRepository, useValue: hostFeeRepository },
      ],
    }).compile();

    service = moduleRef.get(HostFeeService);
  });

  it("adds up what is still owed, a fee partly withheld and a waived one included", async () => {
    fee("a", { withheldCents: cents(4_000) });
    fee("b", {
      waivedAt: NOW.toISOString(),
      waiveReason: "Flood",
      waivedBy: { id: ADMIN_ID, name: "Ada Admin" },
    });
    // Over a year old and still owed: counts towards the debt, not the window.
    fee("c", { createdAt: "2025-01-01T12:00:00.000Z" });

    const overview = await service.overviewOf(HOST_ID, "admin", NOW);

    // The waived fee is listed, but its cancellation is not counted — as the admins' notice.
    expect(overview).toMatchObject({
      cancellationsInWindow: 1,
      owedCents: 16_000,
    });
    expect(overview.fees.map(({ id }) => id)).toContain("b");
  });

  it("waives a fee still owed once, keeping what was withheld and who waived it", async () => {
    fee("a", { withheldCents: cents(4_000) });

    await service.waive("a", "The host was in hospital", ADMIN_ID);

    expect(hostFeeRepository.fees[0]).toMatchObject({
      withheldCents: 4_000,
      waiveReason: "The host was in hospital",
    });
    expect(hostFeeRepository.fees[0]?.waivedBy).toEqual({
      id: ADMIN_ID,
      name: "Ada Admin",
    });
    await expect(service.waive("a", "Again", ADMIN_ID)).rejects.toThrow(
      ConflictException,
    );
    await expect(
      service.overviewOf(HOST_ID, "admin", NOW),
    ).resolves.toMatchObject({ owedCents: 0 });
  });

  it("tells an admin who waived a fee, and the host only that it was waived", async () => {
    fee("a");
    await service.waive("a", "A flood", ADMIN_ID);

    const [forAdmin] = (await service.overviewOf(HOST_ID, "admin", NOW)).fees;
    const [forHost] = (await service.overviewOf(HOST_ID, "host", NOW)).fees;

    expect(forAdmin?.waivedBy).toEqual({ id: ADMIN_ID, name: "Ada Admin" });
    expect(forHost).toMatchObject({ waiveReason: "A flood", waivedBy: null });
  });

  it("refuses a waiver from an account gone or no longer an admin, waiving nothing", async () => {
    fee("a");

    await expect(service.waive("a", "Late", GONE_ID)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.waive("a", "Late", DEMOTED_ID)).rejects.toThrow(
      ForbiddenException,
    );
    // The caller is checked before the fee: a missing id tells a former admin nothing.
    await expect(service.waive("missing", "Late", DEMOTED_ID)).rejects.toThrow(
      ForbiddenException,
    );
    expect(hostFeeRepository.fees[0]?.waivedAt).toBeNull();
  });

  it("refuses to waive a fee withheld in full, and one that is not there", async () => {
    fee("a", { withheldCents: cents(10_000) });

    await expect(service.waive("a", "Late", ADMIN_ID)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.waive("missing", "Late", ADMIN_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
