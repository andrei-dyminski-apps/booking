import { tz } from "@date-fns/tz";
import { addDays, format, parseISO } from "date-fns";
import {
  bookingQuerySchema,
  Role,
  type Booking,
  type BookingQuery,
  type BookingSort,
  type CreateBookingInput,
  type ListingSummary,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../../../auth/auth.types";
import { cents } from "../../../payment/domain/money";
import { ACTIVE_STATUSES } from "../../domain/booking-status";

/*
 * The fixtures the booking specs and the fakes beside this file share. Kept out of the
 * build by `tsconfig.build.json` (`*.fakes.ts`), like every file of this directory.
 */
export const GUEST_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
export const OWNER_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
export const STRANGER_ID = "7e1a3d2f-2b3c-4d5e-9f6a-0b1c2d3e4f50";
export const LISTING_ID = "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
export const OTHER_LISTING_ID = "3a4b5c6d-7e8f-4091-8a2b-3c4d5e6f7a8b";

/** What the repository resolves beside every stay; no rule in this service reads it. */
export const listing: ListingSummary = {
  title: "Loft above the harbour",
  pricePerNightCents: cents(12_000),
};

export const input: CreateBookingInput = {
  listingId: LISTING_ID,
  from: "2026-09-01",
  to: "2026-09-05",
};

/** What every stay the fake takes costs; the quote itself is `quoteStay`'s and the e2e's. */
export const AMOUNT = cents(48_000);

export const IN_UTC = { in: tz("UTC") };

export const day = (offset: number): string =>
  format(addDays(parseISO("2026-09-01", IN_UTC), offset), "yyyy-MM-dd");

/**
 * The nth stay of a fixture that needs several: a week apart, so no two of them overlap
 * and the fake refuses none — what these specs are about is the paging and the ordering,
 * not the slot.
 */
export const stayAfter = (index: number): CreateBookingInput => ({
  ...input,
  from: day(index * 7),
  to: day(index * 7 + 2),
});

export const userWith = (id: string, role: Role): AuthenticatedUser => ({
  id,
  email: "someone@example.com",
  role,
});

export const guest = userWith(GUEST_ID, Role.USER);
export const owner = userWith(OWNER_ID, Role.USER);
export const stranger = userWith(STRANGER_ID, Role.USER);
export const admin = userWith(STRANGER_ID, Role.ADMIN);

/** See `auth.service.spec.ts` for what this mapped type does and does not catch. */
export type PublicOf<T> = { [K in keyof T]: T[K] };

/**
 * A query as it reaches the service: parsed by the contract rather than written out, so a
 * spec never states a default the API does not have.
 */
export const searchFor = (search: Record<string, string> = {}): BookingQuery =>
  bookingQuerySchema.parse(search);

export const compare = (left: string, right: string): number => {
  if (left < right) return -1;

  return left > right ? 1 : 0;
};

/** The four orderings of the contract, with the tiebreaker following the key. */
export const ordering =
  (sort: BookingSort) =>
  (left: Booking, right: Booking): number => {
    switch (sort) {
      case "newest":
        return (
          compare(right.createdAt, left.createdAt) || compare(right.id, left.id)
        );
      case "oldest":
        return (
          compare(left.createdAt, right.createdAt) || compare(left.id, right.id)
        );
      case "checkInAsc":
        return compare(left.from, right.from) || compare(left.id, right.id);
      case "checkInDesc":
        return compare(right.from, left.from) || compare(right.id, left.id);
    }
  };

export const isActive = (booking: Booking): boolean =>
  ACTIVE_STATUSES.includes(booking.status);

/** Today plus `days`, in UTC — the refund and cancellation rules read the real clock. */
export const fromToday = (days: number): string =>
  format(addDays(new Date(), days, IN_UTC), "yyyy-MM-dd");
