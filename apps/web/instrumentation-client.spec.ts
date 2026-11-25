import { describe, expect, it } from "vitest";

// The hook writes zod's undocumented global rather than calling `config()`, which would
// pull zod's core into every page; this fails if a zod upgrade stops reading that global.
describe("instrumentation-client", () => {
  it("makes zod jitless before its core loads", async () => {
    await import("./instrumentation-client");
    const { config } = await import("zod");

    expect(config().jitless).toBe(true);
  });
});
