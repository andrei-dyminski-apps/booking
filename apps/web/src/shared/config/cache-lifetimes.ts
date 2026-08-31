/**
 * How long a cached read may go on answering, in seconds, for the answers that change on
 * a timer rather than on a mutation of this application.
 *
 * Here for the same reason the tags next door are: the number is agreed with the other
 * side of the wire and nothing checks that the two still say it. A tag is invalidated by
 * a write this application performs, so a read carrying only one needs no lifetime; what
 * needs a lifetime is what the API changes on its own.
 */

/**
 * A `PENDING_PAYMENT` hold lapses fifteen minutes after it was taken and puts its nights
 * back on offer. Nothing on this side mutates when it does — the API releases it from a
 * queue — so the reads that show free nights expire on their own instead.
 *
 * A minute is that queue's `SWEEP_INTERVAL_MS` (`apps/api/src/booking/booking-expiry.queue.ts`),
 * so this is the freshness the API itself promises rather than a number picked for the
 * feel of it. The two move together: a slower sweep here would serve nights the API has
 * already released, and a faster one would refetch for an answer that cannot have changed.
 */
export const HOLD_SWEEP_REVALIDATE = 60;
