import { describe, expect, it } from "vitest";
import { toApiIssue } from "./error-code.js";
import {
  isPushServiceEndpoint,
  pushPayloadSchema,
  pushPreferencesSchema,
  pushSubscriptionSchema,
} from "./push.js";

const keys = {
  p256dh:
    "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
  auth: "tBHItJI5svbpez7KI4CCXg",
};

describe("isPushServiceEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QGuQyavXutnMH",
  ])("accepts the endpoint of a browser's push service: %s", (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ["plain http", "http://fcm.googleapis.com/fcm/send/abc"],
    ["another host", "https://example.com/push"],
    ["a lookalike suffix", "https://fcm.googleapis.com.evil.test/push"],
    ["a lookalike prefix", "https://evilpush.apple.com.test/push"],
    ["an internal host", "https://localhost/push"],
    ["an explicit port", "https://fcm.googleapis.com:8443/fcm/send/abc"],
    ["credentials", "https://user:pass@fcm.googleapis.com/fcm/send/abc"],
    ["a fragment", "https://fcm.googleapis.com/fcm/send/abc#alias"],
    ["not a URL", "fcm.googleapis.com/fcm/send/abc"],
  ])("refuses %s", (_, endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false);
  });
});

describe("pushSubscriptionSchema", () => {
  it("takes what PushSubscription.toJSON writes, without the expiration", () => {
    const parsed = pushSubscriptionSchema.parse({
      endpoint: "https://FCM.GOOGLEAPIS.COM:443/fcm/send/abc",
      expirationTime: null,
      keys,
    });

    expect(parsed).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys,
    });
  });

  it("names the rule that refused an endpoint and a key", () => {
    const result = pushSubscriptionSchema.safeParse({
      endpoint: "https://internal.test/push",
      keys: { ...keys, auth: "YWJj" },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => toApiIssue(issue).code)).toEqual(
      ["PUSH_ENDPOINT_INVALID", "PUSH_KEY_INVALID"],
    );
  });
});

describe("pushPayloadSchema", () => {
  const payload = {
    title: "Booking confirmed",
    body: "Your stay is confirmed",
    tag: "notification-1",
    receipt: "5e7c2a9d-8b1f-4d3e-a6c4-2f9b7d1e8a35",
  };

  it("opens a path of the site and nothing on another origin", () => {
    expect(
      pushPayloadSchema.safeParse({ ...payload, url: "/bookings/1" }).success,
    ).toBe(true);
    for (const url of ["//evil.example/x", "https://evil.example", "bookings"])
      expect(pushPayloadSchema.safeParse({ ...payload, url }).success).toBe(
        false,
      );
  });
});

describe("pushPreferencesSchema", () => {
  it("takes quiet hours that wrap past midnight, in a zone it stores canonically", () => {
    const parsed = pushPreferencesSchema.parse({
      muted: ["reviews"],
      quietHours: { from: "22:00", to: "07:30", timeZone: "europe/berlin" },
      hourlyLimit: 5,
    });

    expect(parsed.quietHours).toEqual({
      from: "22:00",
      to: "07:30",
      timeZone: "Europe/Berlin",
    });
  });

  it("refuses a window of no length, a malformed time and a limit out of range", () => {
    const codes = (input: unknown) =>
      pushPreferencesSchema
        .safeParse(input)
        .error?.issues.map((issue) => toApiIssue(issue).code);

    const base = { muted: [], quietHours: null, hourlyLimit: null };

    expect(
      codes({
        ...base,
        quietHours: { from: "08:00", to: "08:00", timeZone: "UTC" },
      }),
    ).toEqual(["PUSH_QUIET_HOURS_INVALID"]);
    expect(
      codes({
        ...base,
        quietHours: { from: "24:00", to: "08:00", timeZone: "UTC" },
      }),
    ).toEqual(["PUSH_QUIET_HOURS_INVALID"]);
    expect(codes({ ...base, hourlyLimit: 0 })).toEqual([
      "PUSH_HOURLY_LIMIT_INVALID",
    ]);
    expect(codes({ ...base, hourlyLimit: 1.5 })).toEqual([
      "PUSH_HOURLY_LIMIT_INVALID",
    ]);
  });
});
