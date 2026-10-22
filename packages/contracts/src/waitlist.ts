import { z } from "zod";
import { userSchema } from "./auth.js";
import { bookingSchema, createBookingSchema } from "./booking.js";
import { blank, PAGING } from "./query.js";

/**
 * How many date ranges one account may wait for at once. The list is answered whole rather
 * than paged, and this is what keeps that honest: every entry is a read the API repeats
 * each time nights come free on its listing.
 */
export const MAX_WAITLIST_ENTRIES = 20;

/**
 * Asking to be told when nights somebody else holds come free. The same three fields and
 * the same two rules a booking has — a waitlist entry is a booking that could not be taken
 * yet, so a range the booking form would refuse is refused here in the same words.
 *
 * The API refuses a range that is free right now (`409`): the answer to free nights is to
 * book them, and an entry nothing will ever release would wait forever.
 */
export const joinWaitlistSchema = createBookingSchema;

/**
 * One range the caller is waiting for. A wish rather than a claim: it holds nothing, and
 * when the nights come free everybody waiting for them is told at once — whoever books
 * first takes them. Told means done: the entry is gone once its notice is written, and
 * waiting again is joining again.
 */
export const waitlistEntrySchema = bookingSchema
  .pick({ listingId: true, listing: true, from: true, to: true })
  .extend({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
  });

/**
 * The caller's entries, the earliest check-in first. Only the ones still ahead: a range
 * whose check-in has passed can no longer be booked, so it is not something to wait for.
 */
export const waitlistSchema = z.array(waitlistEntrySchema);

/**
 * The two orderings of the waitlist on somebody's listings. The check-in first is the
 * default, because the question a host and an admin bring to it is "which nights are
 * wanted next"; the newest first is what has just been asked for.
 */
export const waitlistSortSchema = z.enum(["checkInAsc", "newest"]);

/**
 * The query of `GET /waitlist/demand`, as it arrives in the URL. There is no filter that
 * could be a scope: a user is answered the entries on their own listings, an admin every
 * entry on the site, and nothing here can widen either.
 */
export const waitlistDemandQuerySchema = z.object({
  sort: blank(waitlistSortSchema.default("checkInAsc")),
  ...PAGING,
});

/**
 * Who is waiting — for an admin only. A host is told that a range is wanted and not by
 * whom: a waiter has taken nothing from them yet, so neither their name nor a way to reach
 * them is the host's to read. A booking is what introduces a guest to a host.
 */
export const waiterSchema = userSchema.pick({ id: true, name: true });

/** One range somebody waits for, as the listing's side of it sees it. */
export const waitlistDemandEntrySchema = waitlistEntrySchema.extend({
  waiter: waiterSchema.nullable(),
});

/**
 * One page of it. Paged, unlike the caller's own list: the cap is per waiter, so nothing
 * bounds how many wait on one host's listings, and an admin's scope is the whole site.
 */
export const waitlistDemandPageSchema = z.object({
  items: z.array(waitlistDemandEntrySchema),
  nextCursor: z.string().nullable(),
});

export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;
export type WaitlistSort = z.infer<typeof waitlistSortSchema>;
export type WaitlistDemandQuery = z.infer<typeof waitlistDemandQuerySchema>;
export type WaitlistDemandEntry = z.infer<typeof waitlistDemandEntrySchema>;
export type WaitlistDemandPage = z.infer<typeof waitlistDemandPageSchema>;
