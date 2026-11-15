/**
 * The header one request's id travels in, spelled by both sides: the frontend's proxy
 * mints an id for every request a browser makes and hands it to the API, the API adopts
 * it, and either answer names it back, which is what a user reporting an error can quote.
 */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * What a request id from outside may look like to be written into a log: a UUID, a
 * platform's trace id. The API adopts an incoming `x-request-id` only in this shape, and
 * the frontend's proxy logs Vercel's `x-vercel-id` only in it — either may be a client's,
 * so anything longer or stranger is a value somebody writes into the logs at will.
 */
export const REQUEST_ID_PATTERN = /^[\w.:-]{1,128}$/;

/**
 * nginx's "client closed request" — not a status anybody is answered with, the one the
 * API and the frontend's proxy both log a request by when its client left before the
 * answer was finished, so one query finds them in either log.
 */
export const CLIENT_CLOSED_REQUEST = 499;
