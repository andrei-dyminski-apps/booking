import { generateVAPIDKeys } from "web-push";
import { outcomeOf, WebPushGateway } from "./web-push.gateway";

describe("WebPushGateway", () => {
  it("rejects VAPID keys from different pairs at startup", () => {
    const subject = "mailto:push@example.test";
    const pair = generateVAPIDKeys();

    expect(new WebPushGateway({ subject, ...pair }).publicKey).toBe(
      pair.publicKey,
    );
    expect(
      () =>
        new WebPushGateway({
          subject,
          ...pair,
          privateKey: generateVAPIDKeys().privateKey,
        }),
    ).toThrow("VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY");
  });
});

const now = new Date("2026-07-01T10:00:00Z");

describe("outcomeOf", () => {
  it("reads 201 as taken, 404 or 410 as a browser that is gone and 403 as refused credentials", () => {
    expect(outcomeOf(201, {}, now)).toEqual({ kind: "sent", status: 201 });
    expect(outcomeOf(404, {}, now)).toEqual({ kind: "gone", status: 404 });
    expect(outcomeOf(410, {}, now)).toEqual({ kind: "gone", status: 410 });
    expect(outcomeOf(403, {}, now)).toEqual({
      kind: "forbidden",
      status: 403,
    });
  });

  it("reads Retry-After in seconds and as a date", () => {
    expect(outcomeOf(429, { "retry-after": "120" }, now)).toEqual({
      kind: "throttled",
      status: 429,
      retryAfter: new Date("2026-07-01T10:02:00Z"),
    });
    expect(
      outcomeOf(429, { "retry-after": "Wed, 01 Jul 2026 11:00:00 GMT" }, now),
    ).toEqual({
      kind: "throttled",
      status: 429,
      retryAfter: new Date("2026-07-01T11:00:00Z"),
    });
    expect(outcomeOf(429, { "retry-after": "soon" }, now)).toEqual({
      kind: "throttled",
      status: 429,
      retryAfter: null,
    });
  });

  it("tries a server error again and refuses another client error for good", () => {
    expect(outcomeOf(503, {}, now)).toEqual({
      kind: "unavailable",
      status: 503,
      reason: "503 Service Unavailable",
    });
    expect(outcomeOf(413, {}, now)).toEqual({
      kind: "rejected",
      status: 413,
      reason: "413 Payload Too Large",
    });
  });
});
