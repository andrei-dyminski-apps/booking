import { z } from "zod";

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
  createdAt: z.iso.datetime(),
});

/**
 * A calendar date has no time zone, so "today" needs one chosen for it, and UTC is the
 * only clock both sides of the wire share. The check is therefore a guard against an
 * obvious mistake — a stay booked for last year — and not a precise deadline: within a day
 * of the boundary it can refuse what is still today somewhere. The exact cut-off belongs
 * with the availability rules of phase 4, which know the listing's own time zone.
 */
const today = (): string => new Date().toISOString().slice(0, 10);

/** `guestId` comes from the session, so a request cannot book in another person's name. */
export const createBookingSchema = bookingSchema
  .omit({ id: true, guestId: true, createdAt: true })
  .refine((booking) => booking.from < booking.to, {
    message: "Check-out date must be later than check-in date",
    path: ["to"],
  })
  .refine((booking) => booking.from >= today(), {
    message: "Check-in date cannot be in the past",
    path: ["from"],
  });

export const bookingListSchema = z.array(bookingSchema);

export type Booking = z.infer<typeof bookingSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
