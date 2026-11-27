import { tz, tzOffset } from "@date-fns/tz";
import {
  addHours,
  addMinutes,
  differenceInMilliseconds,
  differenceInMinutes,
  differenceInSeconds,
  startOfMinute,
} from "date-fns";
import type {
  NotificationType,
  PushGroup,
  PushPreferences,
  PushQuietHours,
} from "@repo/contracts";

/**
 * What a push is about, for the groups an account mutes. Exhaustive over the notice types,
 * so a new one does not compile until it is given a group.
 */
export function pushGroupOf(type: NotificationType): PushGroup {
  switch (type) {
    case "BOOKING_REQUESTED":
    case "BOOKING_CANCELLED":
    case "BOOKING_EXPIRED":
    case "BOOKING_CONFIRMED":
    case "STAY_ENDED_EARLY":
      return "stays";
    case "PAYMENT_REFUNDED":
    case "PAYMENT_DISPUTED":
    case "PAYOUT_SENT":
    case "HOST_CANCELLATION_FEE":
      return "payments";
    case "REFUND_FAILED":
    case "PAYOUT_SHORTFALL":
    case "HOST_CANCELLATIONS_THRESHOLD":
    case "PAYMENT_EVENT_FAILED":
    case "CANCELLATION_REFUND_FAILED":
    case "PAYOUT_FAILED":
      return "alerts";
    case "REVIEW_RECEIVED":
      return "reviews";
    case "WAITLIST_AVAILABLE":
      return "waitlist";
  }
}

/**
 * Time from the creation of the news through its delivery, including time spent offline.
 */
export const PUSH_LIFETIME_HOURS = 24;

/** Covers the full provider TTL plus time for the request to reach the provider. */
export const PUSH_ENDPOINT_HOLD_HOURS = PUSH_LIFETIME_HOURS + 1;

/**
 * How long a browser may answer `403` before its subscription is dropped. A `403` is what a
 * subscription made with another VAPID key gets, and also what a misconfigured subject or a
 * server clock off by hours gets from every push service at once: a day of error lines comes
 * before anything is deleted, and one push taken in between starts the count again.
 */
export const PUSH_FORBIDDEN_GRACE_HOURS = 24;

export function isStale(createdAt: Date, now: Date): boolean {
  return remainingPushSeconds(createdAt, now) === 0;
}

export function remainingPushSeconds(createdAt: Date, now: Date): number {
  return Math.max(0, differenceInSeconds(pushExpiresAt(createdAt), now));
}

export function pushExpiresAt(createdAt: Date): Date {
  return addHours(createdAt, PUSH_LIFETIME_HOURS);
}

/** What the worker does with a task whose news is still unread. */
export type PushDecision =
  | { kind: "send" }
  | { kind: "wait"; until: Date }
  | { kind: "skip"; reason: "muted" };

/**
 * The account's own rules, in the order they apply: a muted group is never pushed, and a
 * push in the quiet hours waits for them to end — and is decided again then, when the news
 * may have been read meanwhile. The worker enforces the hourly limit when reserving a send.
 */
export function decide(
  group: PushGroup,
  preferences: PushPreferences,
  now: Date,
): PushDecision {
  if (preferences.muted.includes(group))
    return { kind: "skip", reason: "muted" };

  const until =
    preferences.quietHours === null
      ? null
      : quietHoursEnd(preferences.quietHours, now);

  return until === null ? { kind: "send" } : { kind: "wait", until };
}

/**
 * Find the first instant outside this quiet window, including jumps over an endpoint and
 * the second occurrence of a repeated local hour.
 */
export function quietHoursEnd(
  { from, to, timeZone }: PushQuietHours,
  now: Date,
): Date | null {
  const start = minutesOf(from);
  const end = minutesOf(to);
  const minutesPerDay = 24 * 60;
  let instant = new Date(startOfMinute(now, { in: tz("UTC") }));

  while (true) {
    const offset = tzOffset(timeZone, instant);
    const clock = addMinutes(instant, offset);
    const minute = clock.getUTCHours() * 60 + clock.getUTCMinutes();
    const inside =
      start < end
        ? minute >= start && minute < end
        : minute >= start || minute < end;

    if (!inside) return instant > now ? instant : null;

    const until = addMinutes(
      instant,
      (end - minute + minutesPerDay) % minutesPerDay,
    );
    if (tzOffset(timeZone, until) === offset) return until;

    // The wall clock moved before the projected end. Find the minute of the change and
    // evaluate the window there with the new offset.
    let unchanged = instant;
    let changed = until;
    while (differenceInMinutes(changed, unchanged) > 1) {
      const halfway = addMinutes(
        unchanged,
        Math.floor(differenceInMinutes(changed, unchanged) / 2),
      );

      if (tzOffset(timeZone, halfway) === offset) unchanged = halfway;
      else changed = halfway;
    }
    instant = changed;
  }
}

/** An `HH:mm` clock as minutes after midnight — also how the quiet hours are stored. */
export function minutesOf(clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(":").map(Number);

  return hours * 60 + minutes;
}

/** The limit counts distinct tasks attempted in the hour before now; `null` is none. */
export function withinHourlyLimit(
  attemptedInLastHour: number,
  limit: number | null,
): boolean {
  return limit === null || attemptedInLastHour < limit;
}

/**
 * How often one browser is tried. A push service that answers with a server error or not at
 * all is tried again, later each time: 15 s, 1 min, 4 min, 16 min — an outage of a push
 * service rarely outlasts that, and the last try is still well inside the push's lifetime.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

const FIRST_RETRY_MS = 15_000;

/**
 * How long after the `attempt`-th (from 1) failed try the next one is due. A duration rather
 * than a moment: the outbox adds it to the database's clock, which the relay reads the rows by.
 */
export function retryDelay(attempt: number): number {
  return FIRST_RETRY_MS * 4 ** (attempt - 1);
}

const MIN_THROTTLE_MS = 30_000;
const PUSH_LIFETIME_MS = PUSH_LIFETIME_HOURS * 60 * 60 * 1000;

/**
 * How long the endpoint is left alone after a `429`: its `Retry-After` (read on the API's
 * clock, the same one `now` is), with a minimum pause of half a minute and at most a push's
 * lifetime: no push written now could wait longer, and a pause without a bound would keep the
 * endpoint's hold, and its silence, for as long as the header asked.
 */
export function throttlePause(retryAfter: Date | null, now: Date): number {
  const asked =
    retryAfter === null ? 0 : differenceInMilliseconds(retryAfter, now);

  return Math.min(Math.max(asked, MIN_THROTTLE_MS), PUSH_LIFETIME_MS);
}
