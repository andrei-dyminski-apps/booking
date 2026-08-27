import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { z } from "zod";

/**
 * The lifecycle of a stay, mirrored by the `BookingStatus` enum of the Prisma schema.
 * `PENDING_PAYMENT` is a hold — the slot is taken while the guest pays, and `expiresAt`
 * is when the hold lapses. `CONFIRMED` is a paid stay (phase 5). `CANCELLED` and
 * `EXPIRED` are terminal and free the slot: only the first two are "active", which is the
 * set the overlap rule and the database `EXCLUDE` constraint act on.
 */
export const bookingStatusSchema = z.enum([
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
]);

/** The four names as a runtime value, the way `Role` is derived from `roleSchema`. */
export const BookingStatus = bookingStatusSchema.enum;

/**
 * Dates are stored as `YYYY-MM-DD`, so they compare lexicographically.
 *
 * A booking names two people-facing rows rather than free text: the listing it takes and
 * the guest who took it. That is what phase 3 checks against — the guest may cancel their
 * own booking, the owner of the listing may read the bookings against it — and no rule of
 * that kind can be written against a `roomId` string and a typed-in guest name.
 */
export const bookingSchema = z.object({
  id: z.uuid(),
  listingId: z.uuid(),
  guestId: z.uuid(),
  from: z.iso.date(),
  to: z.iso.date(),
  status: bookingStatusSchema,
  /**
   * When the hold lapses — and it stays on the row after it has. Which moment a stay
   * stopped holding its slot is what a refund or a dispute asks about, and `status`
   * already says whether it still holds one, so clearing the column would only leave
   * `createdAt` as the single time on the record. `null` is a booking that never was a
   * hold.
   */
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

/**
 * A calendar date has no time zone, so "today" needs one chosen for it, and UTC is the
 * only clock both sides of the wire share. The check is therefore a guard against an
 * obvious mistake — a stay booked for last year — and not a precise deadline: within a day
 * of the boundary it can refuse what is still today somewhere. The exact cut-off belongs
 * with the availability rules of phase 4, which know the listing's own time zone.
 */
const today = (): string => format(TZDate.tz("UTC"), "yyyy-MM-dd");

/**
 * `guestId` comes from the session, so a request cannot book in another person's name.
 * `status` and `expiresAt` are the server's to set — a booking is always created as a
 * hold, and the deadline is computed from the server clock.
 */
export const createBookingSchema = bookingSchema
  .omit({
    id: true,
    guestId: true,
    status: true,
    expiresAt: true,
    createdAt: true,
  })
  .refine((booking) => booking.from < booking.to, {
    message: "Check-out date must be later than check-in date",
    path: ["to"],
  })
  .refine((booking) => booking.from >= today(), {
    message: "Check-in date cannot be in the past",
    path: ["from"],
  });

export const bookingListSchema = z.array(bookingSchema);

export type BookingStatus = z.infer<typeof bookingStatusSchema>;
export type Booking = z.infer<typeof bookingSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
