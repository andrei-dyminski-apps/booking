import { describe, expect, it } from "vitest";
import { hostShare, payoutDueAt } from "./payout.js";

describe("hostShare", () => {
  it("pays the host the stay less the platform's tenth, to the cent", () => {
    expect(hostShare(361.05, 0)).toBe(324.95);
    expect(hostShare(480, 0)).toBe(432);
  });

  it("pays on what is left after a partial refund", () => {
    expect(hostShare(480, 80)).toBe(360);
  });

  it("pays nothing for a stay refunded in full, or past it", () => {
    expect(hostShare(361.05, 361.05)).toBe(0);
    expect(hostShare(100, 120)).toBe(0);
  });
});

describe("payoutDueAt", () => {
  it("falls due a day after midnight UTC of the check-in day", () => {
    expect(payoutDueAt("2030-10-14").toISOString()).toBe(
      "2030-10-15T00:00:00.000Z",
    );
  });
});
