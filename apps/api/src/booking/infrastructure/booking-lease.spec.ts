import type { PrismaService } from "../../prisma/prisma.service";
import { whileLeased } from "./booking-lease";

const TIMING = {
  leaseMs: 60_000,
  waitMs: 1_000,
  pollMs: 10,
  pollMaxMs: 100,
};

/** A database that grants the lease and then refuses to let it go. */
const refusingRelease = () =>
  ({
    $queryRaw: jest.fn().mockResolvedValue([{ token: "2026-10-25 12:00:00" }]),
    $executeRaw: jest.fn().mockRejectedValue(new Error("connection lost")),
  }) as unknown as PrismaService;

describe("whileLeased", () => {
  it("answers what the work answered when letting go of the lease fails", async () => {
    await expect(
      whileLeased(refusingRelease(), "cancelling_until", "id", TIMING, () =>
        Promise.resolve("cancelled"),
      ),
    ).resolves.toBe("cancelled");
  });

  it("throws what the work threw when letting go of the lease fails", async () => {
    await expect(
      whileLeased(refusingRelease(), "cancelling_until", "id", TIMING, () =>
        Promise.reject(new Error("refused by the provider")),
      ),
    ).rejects.toThrow("refused by the provider");
  });
});
