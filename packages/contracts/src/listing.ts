import { z } from "zod";

/**
 * A place to stay, owned by exactly one OWNER.
 *
 * `pricePerNight` is an integer in the minor unit of the currency (cents), never a float:
 * money in a `number` accumulates rounding the moment a stay is more than one night, and
 * Stripe takes the amount in minor units anyway — phase 5 hands this value straight to a
 * PaymentIntent. The ceiling is what a single night may cost, 1 000 000 minor units.
 */
export const listingSchema = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(10).max(2000),
  pricePerNight: z.int().positive().max(1_000_000),
  capacity: z.int().min(1).max(50),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/**
 * `ownerId` is omitted rather than optional: the owner is the signed-in user, taken from
 * the session on the server. Accepting it from the client would make the field a way to
 * create a listing in somebody else's name — the same reason the price of a stay is
 * computed by the server in phase 5 instead of being sent along with the booking.
 */
export const createListingSchema = listingSchema.omit({
  id: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * A PATCH body: any subset of the editable fields, but not an empty one — an update that
 * changes nothing is a mistake on the caller's side rather than a no-op worth storing.
 */
export const updateListingSchema = createListingSchema
  .partial()
  .refine((listing) => Object.keys(listing).length > 0, {
    message: "At least one field must be provided",
  });

export const listingListSchema = z.array(listingSchema);

export type Listing = z.infer<typeof listingSchema>;
export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
