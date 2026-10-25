import { z } from "zod";
import { stayPartySchema } from "./booking.js";
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
 * - `BOOKING_EXPIRED` — a hold the recipient is one side of lapsed unpaid and let its
 *   nights go; nobody did it, so both sides hear, and `recipient` says which one this is.
 * - `BOOKING_CONFIRMED` — a hold the recipient is one side of was paid and is now a stay;
 *   the payment provider said so rather than either of them, so both sides hear.
 * - `PAYMENT_REFUNDED` — money the guest paid went back to them without a cancellation of
 *   theirs saying so: the payment arrived for a hold that no longer held its nights (it
 *   lapsed or was cancelled while the payment was on its way), or part of a stay was
 *   refunded from the payment provider's dashboard.
 * - `PAYMENT_DISPUTED` — the guest of a stay at the recipient's listing disputed the payment
 *   with their bank; the host's payout for it waits until the dispute is decided.
 * - `PAYOUT_SENT` — the recipient's share of a stay at their listing was transferred to
 *   their payout account; `amount` is what was sent.
 * - `REVIEW_RECEIVED` — the other side of a finished stay reviewed the recipient: a guest
 *   reviewed their listing (`kind: LISTING`) or a host reviewed them (`kind: GUEST`).
 * - `WAITLIST_AVAILABLE` — nights the recipient was waiting for came free. Nothing is held
 *   for them: everybody waiting for those nights hears at once, and the first to book
 *   takes them.
 *
 * A new kind is a new member of the union below and nothing else on this side: the API
 * stores `data` as it is given, and every switch over `type` on the frontend is exhaustive,
 * so a kind nobody words stops compiling there.
 */
export const notificationTypeSchema = z.enum([
  "BOOKING_REQUESTED",
  "BOOKING_CANCELLED",
  "BOOKING_EXPIRED",
  "BOOKING_CONFIRMED",
  "PAYMENT_REFUNDED",
  "PAYMENT_DISPUTED",
  "PAYOUT_SENT",
  "REVIEW_RECEIVED",
  "WAITLIST_AVAILABLE",
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

const bookingRequestedSchema = z.object({
  type: z.literal(NotificationType.BOOKING_REQUESTED),
  data: stayNoticeSchema,
});

const bookingCancelledSchema = z.object({
  type: z.literal(NotificationType.BOOKING_CANCELLED),
  data: stayNoticeSchema.extend({ recipient: stayPartySchema }),
});

const bookingExpiredSchema = z.object({
  type: z.literal(NotificationType.BOOKING_EXPIRED),
  data: stayNoticeSchema.extend({ recipient: stayPartySchema }),
});

const bookingConfirmedSchema = z.object({
  type: z.literal(NotificationType.BOOKING_CONFIRMED),
  data: stayNoticeSchema.extend({ recipient: stayPartySchema }),
});

/** Only the guest paid, so only the guest is told; `amount` is what went back. */
const paymentRefundedSchema = z.object({
  type: z.literal(NotificationType.PAYMENT_REFUNDED),
  data: stayNoticeSchema.extend({ amount: z.number() }),
});

/** Only the host's money waits on a dispute, so only the host is told. */
const paymentDisputedSchema = z.object({
  type: z.literal(NotificationType.PAYMENT_DISPUTED),
  data: stayNoticeSchema,
});

/** `amount` is the host's share as it was transferred, the platform's fee already off. */
const payoutSentSchema = z.object({
  type: z.literal(NotificationType.PAYOUT_SENT),
  data: stayNoticeSchema.extend({ amount: z.number() }),
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
 * The nights a waitlist entry asked for, copied the way a stay is. No booking to name: the
 * nights belong to nobody yet, which is the news.
 */
const waitlistAvailableSchema = z.object({
  type: z.literal(NotificationType.WAITLIST_AVAILABLE),
  data: stayNoticeSchema.omit({ bookingId: true }),
});

/**
 * The type and its data as one value, which is what a writer hands the API and what the
 * column stores. Discriminated on `type`, so a reader that has checked the type has the
 * data of that type and no other.
 */
export const notificationContentSchema = z.discriminatedUnion("type", [
  bookingRequestedSchema,
  bookingCancelledSchema,
  bookingExpiredSchema,
  bookingConfirmedSchema,
  paymentRefundedSchema,
  paymentDisputedSchema,
  payoutSentSchema,
  reviewReceivedSchema,
  waitlistAvailableSchema,
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
  bookingExpiredSchema.extend(stored),
  bookingConfirmedSchema.extend(stored),
  paymentRefundedSchema.extend(stored),
  paymentDisputedSchema.extend(stored),
  payoutSentSchema.extend(stored),
  reviewReceivedSchema.extend(stored),
  waitlistAvailableSchema.extend(stored),
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
 *
 * The unread threads are counted under the same lock and read the same clock, so one
 * revision orders every count an account has — this one and the event stream's
 * `unreadConversations` alike.
 */
export const unreadRevisionSchema = z.int().min(0);

/** How many are still unread — the number on the bell — and when that was counted. */
export const unreadCountSchema = z.object({
  unread: z.int().min(0),
  revision: unreadRevisionSchema,
});

export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type StayNotice = z.infer<typeof stayNoticeSchema>;
export type NotificationContent = z.infer<typeof notificationContentSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationSort = z.infer<typeof notificationSortSchema>;
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type NotificationPage = z.infer<typeof notificationPageSchema>;
export type UnreadCount = z.infer<typeof unreadCountSchema>;
