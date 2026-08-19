import { z } from "zod";

/** Dates are stored as `YYYY-MM-DD`, so they compare lexicographically. */
export const bookingSchema = z.object({
  id: z.uuid(),
  roomId: z.string().min(1).max(50),
  guestName: z.string().trim().min(2).max(100),
  from: z.iso.date(),
  to: z.iso.date(),
  createdAt: z.iso.datetime(),
});

export const createBookingSchema = bookingSchema
  .omit({ id: true, createdAt: true })
  .refine((booking) => booking.from < booking.to, {
    message: "Check-out date must be later than check-in date",
    path: ["to"],
  });

export const bookingListSchema = z.array(bookingSchema);

export type Booking = z.infer<typeof bookingSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
