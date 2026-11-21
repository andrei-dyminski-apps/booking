import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The pace of a run against the live deployment (`target.ts`), where the whole run is one
 * visitor to the rate limiter: the suite cannot pick its own bucket there — Vercel writes
 * the address in `x-forwarded-for` itself — so every page, every arrangement and every
 * sign-in of the run counts against the same address. No retries for the same reason: a
 * retry would meet the limiter still remembering the first attempt.
 *
 * Two limits matter (`README.md`, "Rate limiting"), and the limiter counts each route apart
 * — its bucket is the handler and the address, so `x-ratelimit-remaining` is what one
 * route has left: ten sign-ins and ten registrations a minute, and 120 requests a minute
 * on every other route. The first is counted here exactly, the two routes together — every
 * sign-in of the run, through a page, an arrangement or the global setup, takes a slot
 * first, before the step, so the wait is never spent inside an `expect`. The second cannot
 * be, and is read off the answers instead: every answer of the BFF carries the limiter's
 * `x-ratelimit-*` headers, the arrangements' and the global setup's as well as the
 * pages', and a test that starts while any route seen is low waits for that route's
 * window to turn. Which routes the next test will reach is not known here, so a route
 * running low pauses the whole run rather than only what reaches it. What a server render
 * asks the API on the visitor's behalf — `/auth/me` on every personal page — answers the
 * frontend's server, never the browser, so those routes go unwatched: their budget is
 * guessed from the BFF routes the same pages reach.
 *
 * The state lives in a file, not in the module: Playwright starts a new worker after a
 * failed test, and the global setup and teardown run in a process of their own, all of
 * them signing in against the same window. Nothing runs at the same time as anything
 * else — one worker, and the setup and teardown around it — so the file needs no lock.
 * It is one file for the machine rather than one for the run, and outlives the run on
 * purpose: the limiter remembers the address, not the run, so a run started right after
 * another still finds that run's sign-ins in its window.
 *
 * The numbers are the first runs' (`docs/plan.md`, 11.4).
 */

/** Sign-ins a minute the run allows itself, of the ten the API does. */
const SIGN_INS_PER_WINDOW = 8;

/**
 * The limiter's window and a little more, so a slot is reused only once the API has
 * certainly forgotten it.
 */
const WINDOW_MS = 62_000;

/** A route's ceiling a minute, as its answers name it in `x-ratelimit-limit`. */
const ROUTE_LIMIT = "120";

/** Below this many requests left on a route, the next test waits for its next window. */
const LOW_WATER = 40;

/**
 * Where the pace is kept — one file for the machine, the address the limiter counts (see
 * above).
 */
const PACE_FILE = join(tmpdir(), "booking-e2e-live-pace.json");

/**
 * What the limiter still remembers — the sign-ins of the last window and a pause not over
 * yet, whichever run they came from — and what the pace has cost the current test.
 */
type Pace = {
  signIns: number[];
  pausedUntil: number;
  lowest: { left: number; route: string } | null;
  signInWaitMs: number;
  budgetWaitMs: number;
};

const FRESH: Pace = {
  signIns: [],
  pausedUntil: 0,
  lowest: null,
  signInWaitMs: 0,
  budgetWaitMs: 0,
};

/**
 * Starts the run's pace, called once by the global setup: what the limiter may still
 * remember of an earlier run on this machine is kept, anything else starts afresh. A file
 * that cannot be read — none yet, or one an interrupted write left half-done — is a fresh
 * start.
 */
export function startPace(): void {
  let earlier: Pace = FRESH;

  try {
    earlier = read();
  } catch {
    // Nothing to carry over.
  }

  const now = Date.now();

  write({
    ...FRESH,
    signIns: earlier.signIns.filter((at) => at > now - WINDOW_MS),
    pausedUntil: earlier.pausedUntil > now ? earlier.pausedUntil : 0,
  });
}

/** Starts a test's account of the pace, so its report names what that test cost. */
export function startTestPace(): void {
  write({ ...read(), lowest: null, signInWaitMs: 0, budgetWaitMs: 0 });
}

function read(): Pace {
  return JSON.parse(readFileSync(PACE_FILE, "utf8")) as Pace;
}

function write(pace: Pace): void {
  writeFileSync(PACE_FILE, JSON.stringify(pace));
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits until a sign-in fits in the window, and takes its slot. */
export async function signInSlot(): Promise<void> {
  for (;;) {
    const pace = read();
    const now = Date.now();

    pace.signIns = pace.signIns.filter((at) => at > now - WINDOW_MS);

    if (pace.signIns.length < SIGN_INS_PER_WINDOW) {
      pace.signIns.push(now);
      write(pace);

      return;
    }

    const wait = (pace.signIns[0] ?? now) + WINDOW_MS - now;

    pace.signInWaitMs += wait;
    write(pace);
    await sleep(wait);
  }
}

/** Waits, before a test, while a route's budget is low. */
export async function budgetSlot(): Promise<void> {
  const pace = read();
  const wait = pace.pausedUntil - Date.now();

  if (wait <= 0) return;

  pace.budgetWaitMs += wait;
  write(pace);
  await sleep(wait);
}

/** An answer of the BFF, from a page or from a browserless context. */
type Answer = { url(): string; headers(): Record<string, string> };

/**
 * The route an answer came from, as the limiter buckets it: by handler, so an id in the
 * path names the same route whichever row it is.
 */
function routeOf(answer: Answer): string {
  return new URL(answer.url()).pathname.replaceAll(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/g,
    "/:id",
  );
}

/** Reads the limiter's headers off an answer of the BFF. */
export function noteAnswer(answer: Answer): void {
  const headers = answer.headers();

  if (headers["x-ratelimit-limit"] !== ROUTE_LIMIT) return;

  const left = Number(headers["x-ratelimit-remaining"]);
  const reset = Number(headers["x-ratelimit-reset"]);

  if (!Number.isFinite(left)) return;

  const pace = read();

  if (pace.lowest === null || left < pace.lowest.left) {
    pace.lowest = { left, route: routeOf(answer) };
  }

  if (left < LOW_WATER && Number.isFinite(reset)) {
    pace.pausedUntil = Math.max(
      pace.pausedUntil,
      Date.now() + (reset + 1) * 1000,
    );
  }

  write(pace);
}

/** What the pace has cost the current test and how close a route came to its ceiling. */
export function paceReport(): string {
  const { lowest, signInWaitMs, budgetWaitMs } = read();

  return [
    `lowest budget left on a route: ${lowest === null ? "n/a" : `${String(lowest.left)} of ${ROUTE_LIMIT} (${lowest.route})`}`,
    `waited for sign-in slots: ${String(Math.round(signInWaitMs / 1000))} s`,
    `waited for a route's budget: ${String(Math.round(budgetWaitMs / 1000))} s`,
  ].join(", ");
}
