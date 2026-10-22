import type { FormErrors } from "#shared/lib";

/**
 * What the two actions of the booking form answer: the refusal, and whether it was the
 * calendar being out of date — a hold refused over nights it drew as free, or a waitlist
 * refused over nights it drew as taken. The form flips between the two on that, including
 * for nights past the window the calendar reads.
 */
export type ReservationErrors = FormErrors & { stale: boolean };
