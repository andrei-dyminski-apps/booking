import { afterEach, describe, expect, it, vi } from "vitest";
import { siteOrigin, siteUrl } from "./site";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteOrigin", () => {
  it("takes SITE_ORIGIN over the address Vercel names", () => {
    vi.stubEnv("SITE_ORIGIN", "https://stays.example.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "booking.vercel.app");

    expect(siteOrigin()).toBe("https://stays.example.com");
  });

  it("puts https in front of Vercel's production domain, which comes without a scheme", () => {
    vi.stubEnv("SITE_ORIGIN", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "booking.vercel.app");

    expect(siteOrigin()).toBe("https://booking.vercel.app");
  });

  it("falls back to this machine's port when neither is set", () => {
    vi.stubEnv("SITE_ORIGIN", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("WEB_PORT", "3100");

    expect(siteOrigin()).toBe("http://localhost:3100");
  });

  it("reads an empty WEB_PORT as unset, the way the dev script does", () => {
    vi.stubEnv("SITE_ORIGIN", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("WEB_PORT", "");

    expect(siteOrigin()).toBe("http://localhost:3000");
  });

  it("reads a SITE_ORIGIN written without a scheme as https", () => {
    vi.stubEnv("SITE_ORIGIN", "stays.example.com");

    expect(siteOrigin()).toBe("https://stays.example.com");
  });

  it("keeps a local http SITE_ORIGIN and its port", () => {
    vi.stubEnv("SITE_ORIGIN", "http://localhost:3100");

    expect(siteOrigin()).toBe("http://localhost:3100");
  });

  it("passes over a SITE_ORIGIN that is not an address instead of throwing", () => {
    vi.stubEnv("SITE_ORIGIN", "not an address");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "booking.vercel.app");

    expect(siteOrigin()).toBe("https://booking.vercel.app");
  });

  it("passes over a scheme no page is served at", () => {
    vi.stubEnv("SITE_ORIGIN", "ftp://stays.example.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("WEB_PORT", "3100");

    expect(siteOrigin()).toBe("http://localhost:3100");
  });

  it("strips trailing slashes, which would double up in front of every path", () => {
    vi.stubEnv("SITE_ORIGIN", "https://stays.example.com//");

    expect(siteUrl("/listings")).toBe("https://stays.example.com/listings");
  });
});
