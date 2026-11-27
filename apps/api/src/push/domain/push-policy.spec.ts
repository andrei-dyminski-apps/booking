import { DEFAULT_PUSH_PREFERENCES, NotificationType } from "@repo/contracts";
import {
  decide,
  isStale,
  pushGroupOf,
  quietHoursEnd,
  retryDelay,
  throttlePause,
  withinHourlyLimit,
} from "./push-policy";

const at = (iso: string) => new Date(iso);

describe("pushGroupOf", () => {
  it("puts what only an admin is told apart from a host's own money", () => {
    expect(pushGroupOf(NotificationType.PAYOUT_FAILED)).toBe("alerts");
    expect(pushGroupOf(NotificationType.PAYOUT_SENT)).toBe("payments");
    expect(pushGroupOf(NotificationType.BOOKING_EXPIRED)).toBe("stays");
    expect(pushGroupOf(NotificationType.REVIEW_RECEIVED)).toBe("reviews");
  });
});

describe("quietHoursEnd", () => {
  const night = { from: "22:00", to: "07:00", timeZone: "Europe/Berlin" };

  it("is nothing outside a window that wraps past midnight", () => {
    // 12:00 in Berlin (CEST, UTC+2).
    expect(quietHoursEnd(night, at("2026-07-01T10:00:00Z"))).toBeNull();
    // 07:00 sharp is the window's end, already outside it.
    expect(quietHoursEnd(night, at("2026-07-01T05:00:00Z"))).toBeNull();
  });

  it("ends the next morning before midnight and the same morning after it", () => {
    // 23:30 in Berlin → 07:00 the next day, which is 05:00 UTC.
    expect(quietHoursEnd(night, at("2026-07-01T21:30:00Z"))).toEqual(
      at("2026-07-02T05:00:00Z"),
    );
    // 03:00 in Berlin → 07:00 that day.
    expect(quietHoursEnd(night, at("2026-07-02T01:00:00Z"))).toEqual(
      at("2026-07-02T05:00:00Z"),
    );
  });

  it("reads the wall clock of the zone across a change to winter time", () => {
    // 23:00 CEST on 24 October; Berlin goes back to CET (UTC+1) that night, so 07:00 is 06:00 UTC.
    expect(quietHoursEnd(night, at("2026-10-24T21:00:00Z"))).toEqual(
      at("2026-10-25T06:00:00Z"),
    );
  });

  it("takes a window within one day", () => {
    const lunch = { from: "12:00", to: "13:30", timeZone: "UTC" };

    expect(quietHoursEnd(lunch, at("2026-07-01T12:15:00Z"))).toEqual(
      at("2026-07-01T13:30:00Z"),
    );
    expect(quietHoursEnd(lunch, at("2026-07-01T11:59:00Z"))).toBeNull();
  });
});

describe("decide", () => {
  const now = at("2026-07-01T21:30:00Z");

  it("sends by default", () => {
    expect(decide("stays", DEFAULT_PUSH_PREFERENCES, now)).toEqual({
      kind: "send",
    });
  });

  it("skips a muted group before it looks at the clock", () => {
    expect(
      decide(
        "reviews",
        {
          ...DEFAULT_PUSH_PREFERENCES,
          muted: ["reviews"],
          quietHours: { from: "22:00", to: "07:00", timeZone: "UTC" },
        },
        now,
      ),
    ).toEqual({ kind: "skip", reason: "muted" });
  });

  it("waits out the quiet hours", () => {
    expect(
      decide(
        "messages",
        {
          ...DEFAULT_PUSH_PREFERENCES,
          quietHours: { from: "21:00", to: "07:00", timeZone: "UTC" },
        },
        now,
      ),
    ).toEqual({ kind: "wait", until: at("2026-07-02T07:00:00Z") });
  });
});

describe("the limits of a push", () => {
  it("counts the pushes of the last hour against the limit, if any", () => {
    expect(withinHourlyLimit(2, 3)).toBe(true);
    expect(withinHourlyLimit(3, 3)).toBe(false);
    expect(withinHourlyLimit(1000, null)).toBe(true);
  });

  it("goes stale a day after the news", () => {
    const written = at("2026-07-01T10:00:00Z");

    expect(isStale(written, at("2026-07-02T09:59:59Z"))).toBe(false);
    expect(isStale(written, at("2026-07-02T10:00:00Z"))).toBe(true);
  });

  it("waits longer before each retry", () => {
    expect(retryDelay(1)).toBe(15_000);
    expect(retryDelay(2)).toBe(60_000);
    expect(retryDelay(4)).toBe(960_000);
  });

  it("honors the endpoint's Retry-After between a minimum pause and a push's lifetime", () => {
    const now = at("2026-07-01T10:00:00Z");
    const hour = 60 * 60 * 1000;

    expect(throttlePause(null, now)).toBe(30_000);
    expect(throttlePause(at("2026-07-01T10:00:05Z"), now)).toBe(30_000);
    expect(throttlePause(at("2026-07-01T20:00:00Z"), now)).toBe(10 * hour);
    // No push written now outlives a day, so neither does the pause.
    expect(throttlePause(at("2026-07-03T00:00:00Z"), now)).toBe(24 * hour);
  });
});
