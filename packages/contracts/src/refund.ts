import { tz } from "@date-fns/tz";
import { addHours, isAfter, isBefore, min, parseISO, subHours } from "date-fns";
import { BookingStatus, type Booking } from "./booking.js";
import {
  CANCELLATION_TERMS,
  GRACE_MIN_LEAD_HOURS,
  GRACE_PERIOD_HOURS,
} from "./cancellation-policy.js";
import {
  BASIS_POINTS,
  minCents,
  NO_CENTS,
  shareOf,
  subtractCents,
  type Cents,
} from "./money.js";

/**
 * Here for the reason `nightlyPrice` is: the API refunds by it and the booking page states
 * it before the button, so a copy on each side would promise one refund and give another.
 */

export type Canceller = "GUEST" | "ADMIN";

const IN_UTC = { in: tz("UTC") };

/**
 * The moment every window of a cancellation is measured from: midnight UTC of the check-in
 * day for now, so every runtime agrees on the instant. The one place that knows it — a
 * check-in in the listing's own time zone changes this function and nothing else.
 */
export function checkInInstant(booking: Pick<Booking, "from">): Date {
  // A plain `Date`: a `TZDate` spells even its ISO string its own way.
  return new Date(parseISO(booking.from, IN_UTC).getTime());
}

/**
 * One window of a stay's schedule: a guest who cancels before `until` — and after the
 * window before it closed — is given back `shareBps` of what they paid.
 */
export type RefundWindow = { until: Date; shareBps: number };

type ScheduledStay = Pick<Booking, "from" | "createdAt" | "cancellationPolicy">;

/**
 * Every window of a guest's cancellation of this stay, earliest first, the policy's tiers
 * and the grace period folded into one: whichever gives more applies. After the last
 * window a cancellation refunds nothing, so a schedule with no windows is a stay that could
 * never refund a guest. The windows that closed since the stay was booked are part of it —
 * the stay's page shows the whole schedule — but not those that closed before it: nobody
 * could cancel in them, and folded with the grace period they would state a share the stay
 * never had.
 */
export function refundSchedule(stay: ScheduledStay): RefundWindow[] {
  const anchor = checkInInstant(stay);
  const booked = parseISO(stay.createdAt);
  const terms = CANCELLATION_TERMS[stay.cancellationPolicy];
  const windows: RefundWindow[] = terms.tiers.map((tier) => ({
    until: subHours(anchor, tier.hoursBefore, IN_UTC),
    shareBps: tier.shareBps,
  }));

  if (terms.grace) {
    windows.push({
      until: min([
        addHours(booked, GRACE_PERIOD_HOURS, IN_UTC),
        subHours(anchor, GRACE_MIN_LEAD_HOURS, IN_UTC),
      ]),
      shareBps: BASIS_POINTS,
    });
  }

  // Every window is "before a moment", so the share only ever falls as time passes: the
  // share up to each closing moment is the largest of the windows still open just before it.
  // The closings are plain `Date`s again, for the reason `checkInInstant` gives.
  const closings = [...new Set(windows.map(({ until }) => until.getTime()))]
    .sort((left, right) => left - right)
    .map((time) => new Date(time));
  const schedule: RefundWindow[] = [];

  for (const until of closings) {
    const shareBps = Math.max(
      0,
      ...windows
        .filter((window) => !isBefore(window.until, until))
        .map((window) => window.shareBps),
    );
    const last = schedule.at(-1);

    if (last?.shareBps === shareBps) {
      last.until = until;
    } else {
      schedule.push({ until, shareBps });
    }
  }

  return schedule.filter(
    ({ until, shareBps }) => shareBps > 0 && isAfter(until, booked),
  );
}

/**
 * What a cancellation gives back right now: the share of the payment, the cents it comes to,
 * and — for a guest — when that share ends and what follows it (`null` once nothing is left
 * to fall, or for an admin), and the window that closed last before now (`null` while none
 * has, or for an admin): what waiting has cost so far.
 */
export type RefundQuote = {
  /** The share of the payment a cancellation gives back right now. */
  shareBps: number;
  /** That share in cents, less whatever was refunded already. */
  cents: Cents;
  /**
   * The drop ahead: `until` is the moment the current share ends, `shareBps` what it falls
   * to once it does (the following window's share, `0` after the last window). `null` when
   * no share is left to fall — the schedule is spent — and for an admin.
   */
  next: { until: Date; shareBps: number } | null;
  /**
   * The window that closed last before now, with the share it offered: what waiting has
   * cost so far. When every window has closed it is the last one. `null` while no window
   * has closed yet, and for an admin.
   */
  closed: RefundWindow | null;
};

type QuotedStay = ScheduledStay &
  Pick<Booking, "amountCents" | "refundedAmountCents">;

/**
 * The guest is owed their share of the whole amount less whatever was refunded already —
 * from the payment provider's dashboard, say — rounded half up in their favour, and never a
 * negative amount. An admin's cancellation refunds whatever is left in full: it is the site
 * taking the stay away, not the guest changing their mind. Whether a payment exists at all
 * is the caller's to know.
 */
export function refundQuote(
  stay: QuotedStay,
  now: Date,
  canceller: Canceller,
): RefundQuote {
  if (canceller === "ADMIN") {
    return {
      shareBps: BASIS_POINTS,
      cents: notRefunded(stay.amountCents, stay.refundedAmountCents),
      next: null,
      closed: null,
    };
  }

  const schedule = refundSchedule(stay);
  const at = schedule.findIndex(({ until }) => isBefore(now, until));
  const current = schedule[at];

  if (current === undefined) {
    return {
      shareBps: 0,
      cents: NO_CENTS,
      next: null,
      closed: schedule.at(-1) ?? null,
    };
  }

  return {
    shareBps: current.shareBps,
    cents: notRefunded(
      shareOf(stay.amountCents, current.shareBps),
      stay.refundedAmountCents,
    ),
    next: {
      until: current.until,
      shareBps: schedule[at + 1]?.shareBps ?? 0,
    },
    closed: schedule[at - 1] ?? null,
  };
}

/**
 * One rule for the guest and an admin: from check-in on the nights are being spent, and a
 * cancellation would refund nights already used.
 */
export function isCancellableOn(
  booking: Pick<Booking, "status" | "from">,
  today: string,
): boolean {
  return (
    booking.status === BookingStatus.PENDING_PAYMENT ||
    (booking.status === BookingStatus.CONFIRMED && today < booking.from)
  );
}

/**
 * What is left of an amount after the refunds recorded against it: what a cancellation
 * "in full" gives back, and what the host's share is taken of. Nothing for an amount
 * refunded in full or past it, rather than a negative amount.
 */
export function notRefunded(amount: Cents, refunded: Cents | null): Cents {
  return subtractCents(amount, minCents(amount, refunded ?? NO_CENTS));
}
