import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `apiOrigin()` caches the value in a module-level variable on the first read, so each
 * case needs its own copy of the module — `resetModules` plus a fresh dynamic import is
 * what a fresh cache buys, the same way a fresh cookie jar does in `session-cookies.spec.ts`.
 */

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("apiOrigin", () => {
  it("throws with its own name when API_ORIGIN is not set", async () => {
    vi.stubEnv("API_ORIGIN", "");
    const { apiOrigin } = await import("./api-url");

    expect(() => apiOrigin()).toThrow(/API_ORIGIN/);
  });

  it("strips a trailing slash, which would otherwise double up in every request path", async () => {
    vi.stubEnv("API_ORIGIN", "http://localhost:3001/");
    const { apiOrigin } = await import("./api-url");

    expect(apiOrigin()).toBe("http://localhost:3001");
  });

  it("strips more than one trailing slash", async () => {
    vi.stubEnv("API_ORIGIN", "http://localhost:3001//");
    const { apiOrigin } = await import("./api-url");

    expect(apiOrigin()).toBe("http://localhost:3001");
  });

  it("caches the first reading rather than re-reading the environment", async () => {
    vi.stubEnv("API_ORIGIN", "http://localhost:3001");
    const { apiOrigin } = await import("./api-url");

    expect(apiOrigin()).toBe("http://localhost:3001");

    vi.stubEnv("API_ORIGIN", "http://elsewhere:9999");

    expect(apiOrigin()).toBe("http://localhost:3001");
  });
});
