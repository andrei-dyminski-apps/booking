import { BookingStatus } from "@repo/contracts";

/**
 * The status set, the legal transitions between them and the hold's lifetime — pure
 * functions with no Nest and no Prisma, so the rules are read and tested on their own.
 * The repository owns the queries and the locking transaction; this file owns what a
 * status means.
 *
 * `BookingStatus` is both a value and a type here, the way `Role` is: the object below is
 * `bookingStatusSchema.enum`, the annotations are the string union it infers.
 */

/** How long a hold keeps the slot while the guest pays. 15 minutes, as in the plan. */
export const HOLD_TTL_MS = 15 * 60 * 1000;

/**
 * The statuses that hold the slot: an overlap check and the database `EXCLUDE` constraint
 * both act on exactly this set, and a `CANCELLED` or `EXPIRED` row keeps its record
 * without standing in the way of a new stay.
 */
export const ACTIVE_STATUSES: readonly BookingStatus[] = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
];

/** When a hold created now lapses. */
export function holdExpiry(now: Date): Date {
  return new Date(now.getTime() + HOLD_TTL_MS);
}

/**
 * The transitions the lifecycle allows. A hold is paid (`CONFIRMED`), cancelled or left
 * to expire; a confirmed stay can still be cancelled; `CANCELLED` and `EXPIRED` are
 * terminal. Phase 5 reads this on the payment webhook — phase 4 uses it for cancellation.
 */
const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  [BookingStatus.PENDING_PAYMENT]: [
    BookingStatus.CONFIRMED,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
  ],
  [BookingStatus.CONFIRMED]: [BookingStatus.CANCELLED],
  [BookingStatus.CANCELLED]: [],
  [BookingStatus.EXPIRED]: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Whether a booking in this status can still be cancelled by its guest or an admin. */
export function isCancellable(status: BookingStatus): boolean {
  return canTransition(status, BookingStatus.CANCELLED);
}
