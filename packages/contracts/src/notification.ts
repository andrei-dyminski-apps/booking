import { z } from "zod";
import { reviewKindSchema, reviewSchema } from "./review.js";
import { PAGING } from "./query.js";

/**
 * What happened, from the point of view of the person told about it. Each kind names the
 * event rather than the screen it leads to: the frontend decides the wording and the link,
 * the API only states the fact — so a second language, or a second client, changes nothing
 * here.
 *
 * - `BOOKING_REQUESTED` — a guest took a hold on one of the recipient's listings.
 * - `BOOKING_CANCELLED` — a stay the recipient is one side of was cancelled by the other
 *   side or by an admin; `recipient` says which side they are.
 * - `REVIEW_RECEIVED` — the other side of a finished stay reviewed the recipient: a guest
 *   reviewed their listing (`kind: LISTING`) or a host reviewed them (`kind: GUEST`).
 *
 * A new kind is a new member of the union below and nothing else on this side: the API
 * stores `data` as it is given, and every switch over `type` on the frontend is exhaustive,
 * so a kind nobody words stops compiling there.
 */
export const notificationTypeSchema = z.enum([
  "BOOKING_REQUESTED",
  "BOOKING_CANCELLED",
  "REVIEW_RECEIVED",
]);

export const NotificationType = notificationTypeSchema.enum;

/**
 * The stay a booking notice is about, copied at the moment it happened. A copy rather than
 * a reference resolved on read: a listing can be retired and renamed afterwards, and what
 * the recipient was told about is what the listing was called then.
 */
const stayNoticeSchema = z.object({
  bookingId: z.uuid(),
  listingId: z.uuid(),
  listingTitle: z.string(),
  from: z.iso.date(),
  to: z.iso.date(),
});

/** Which side of the stay the recipient is — a guest and a host are told different things. */
export const stayPartySchema = z.enum(["GUEST", "HOST"]);

export const StayParty = stayPartySchema.enum;

const bookingRequestedSchema = z.object({
  type: z.literal(NotificationType.BOOKING_REQUESTED),
  data: stayNoticeSchema,
});

const bookingCancelledSchema = z.object({
  type: z.literal(NotificationType.BOOKING_CANCELLED),
  data: stayNoticeSchema.extend({ recipient: stayPartySchema }),
});

const reviewReceivedSchema = z.object({
  type: z.literal(NotificationType.REVIEW_RECEIVED),
  data: z.object({
    reviewId: z.uuid(),
    bookingId: z.uuid(),
    kind: reviewKindSchema,
    listingId: z.uuid(),
    listingTitle: z.string(),
    /** The guest of the stay — whose page the hosts' reviews live on. */
    guestId: z.uuid(),
    rating: reviewSchema.shape.rating,
  }),
});

/**
 * The type and its data as one value, which is what a writer hands the API and what the
 * column stores. Discriminated on `type`, so a reader that has checked the type has the
 * data of that type and no other.
 */
export const notificationContentSchema = z.discriminatedUnion("type", [
  bookingRequestedSchema,
  bookingCancelledSchema,
  reviewReceivedSchema,
]);

/**
 * One notification as its recipient reads it. `readAt` is a moment rather than a flag for
 * the reason `blockedAt` is: when is the first thing anybody asks of a yes.
 */
const stored = {
  id: z.uuid(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
};

export const notificationSchema = z.discriminatedUnion("type", [
  bookingRequestedSchema.extend(stored),
  bookingCancelledSchema.extend(stored),
  reviewReceivedSchema.extend(stored),
]);

/**
 * Newest first and nothing else: a feed of what happened is read from the top, and an
 * ordering nobody asks for is one more index to keep. The cursor still carries the sort,
 * because the envelope every cursor of this API is written in does.
 */
export const notificationSortSchema = z.enum(["newest"]);

export const notificationQuerySchema = z.object({
  ...PAGING,
});

export const notificationPageSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
});

/**
 * When a count of the unread was taken, as a number that only grows: every count of one
 * account is taken under that account's lock, one after another, so a later count always
 * has a higher revision. The counts reach a browser by more than one road — the answer to
 * its own write, the event stream, another tab — and not necessarily in the order they
 * were taken. A client keeps the count with the highest revision it has seen and ignores
 * an older one arriving late.
 */
export const unreadRevisionSchema = z.int().min(0);

/** How many are still unread — the number on the bell — and when that was counted. */
export const unreadCountSchema = z.object({
  unread: z.int().min(0),
  revision: unreadRevisionSchema,
});

export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type StayParty = z.infer<typeof stayPartySchema>;
export type StayNotice = z.infer<typeof stayNoticeSchema>;
export type NotificationContent = z.infer<typeof notificationContentSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationSort = z.infer<typeof notificationSortSchema>;
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type NotificationPage = z.infer<typeof notificationPageSchema>;
export type UnreadCount = z.infer<typeof unreadCountSchema>;
