import { tz } from "@date-fns/tz";
import {
  chromium,
  request,
  type APIRequestContext,
  type Browser,
} from "@playwright/test";
import {
  bookingPageSchema,
  isCancellableOn,
  listingListSchema,
  userSchema,
  type Booking,
} from "@repo/contracts";
import { addDays, format } from "date-fns";
import { LIVE_ACCOUNTS, LIVE_ORIGIN, liveAccount } from "./live";
import { noteAnswer, signInSlot } from "./pace";

/**
 * What the global setup and teardown of the live target do to the demo (`live-setup.ts`,
 * `live-teardown.ts`), through its own HTTP surface as any visitor could.
 */

/** A browserless session on the live demo, signed in as one of the suite's accounts. */
export async function liveSession(
  role: keyof typeof LIVE_ACCOUNTS,
): Promise<APIRequestContext> {
  const context = await request.newContext({ baseURL: LIVE_ORIGIN });

  try {
    await signIn(context, role);
  } catch (error) {
    await context.dispose();
    throw error;
  }

  return context;
}

/** Signs in to a dedicated account provisioned for the live suite. */
async function signIn(
  context: APIRequestContext,
  role: keyof typeof LIVE_ACCOUNTS,
): Promise<void> {
  const account = liveAccount(role);

  await signInSlot();
  const signIn = await context.post("/api/auth/login", {
    data: { email: account.email, password: account.password },
  });

  if (signIn.ok()) return;

  if (signIn.status() === 403) {
    throw new Error(
      `The suite's ${role} (${account.email}) is blocked on the live demo: ${await signIn.text()}`,
    );
  }

  throw new Error(
    `Signing in as the suite's ${role} was answered ${String(signIn.status())}. Verify the provisioned account and E2E_LIVE_PASSWORD.`,
  );
}

/** The day an account was registered, as the profile writes it on the reader's clock. */
export async function joinedOn(
  context: APIRequestContext,
  timeZone: string,
): Promise<string> {
  const me = userSchema.parse(
    await answered(await context.get("/api/auth/me")),
  );

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(me.createdAt));
}

/**
 * Leaves the demo as the suite found it, as far as the application allows: every stay of
 * the suite's guest that can still be cancelled is cancelled, and every listing the suite's
 * host still offers is retired, through its page (`retireThroughPages`). Run before the scenarios, for what a run that died left
 * behind, and after them. A stay that has begun cannot be cancelled, and a paid stay ended
 * early or a review cannot be taken back: those stay, on a retired listing, out of the
 * catalogue and out of the next run's way. A refusal does not stop the sweep: what comes
 * after it is still cleared, and the first refusal is what the run reports.
 */
export async function sweep(
  guest: APIRequestContext,
  host: APIRequestContext,
): Promise<void> {
  const refusals: unknown[] = [];

  const attempt = async (step: () => Promise<unknown>) => {
    try {
      await step();
    } catch (error) {
      refusals.push(error);
    }
  };

  await attempt(async () => {
    for (const stay of await openStays(guest)) {
      await attempt(async () => {
        const cancelled = await guest.delete(`/api/bookings/${stay.id}`);

        noteAnswer(cancelled);

        // Gone meanwhile: a hold that lapsed, a stay that began since it was read.
        if (cancelled.ok() || [404, 409].includes(cancelled.status())) return;

        throw new Error(
          `Cancelling the suite's stay ${stay.id} was answered ${String(cancelled.status())}: ${await cancelled.text()}`,
        );
      });
    }
  });

  await attempt(async () => {
    const listings = listingListSchema.parse(
      await answered(await host.get("/api/listings/mine")),
    );

    if (listings.length === 0) return;

    const browser = await chromium.launch();

    try {
      await retireThroughPages(
        browser,
        host,
        listings.map(({ id }) => id),
      );
    } finally {
      await browser.close();
    }
  });

  if (refusals.length > 0) throw refusals[0];
}

/** How long a step of retiring a listing through its page may take on the deployment. */
const RETIRE_STEP_MS = 30_000;

/**
 * Retires the owner's listings the way the owner does, through the delete button of each
 * one's edit screen, in a browser signed in with the owner's session. Its action marks the
 * cached reads that still describe the listing stale (`deleteListingAction`), which a
 * `DELETE` through the BFF does not: a listing's page is cached with no lifetime, and on
 * the deployment, where the cache outlives the run, a page read during it would go on
 * offering the retired stay to anybody with its address. A refusal does not stop the rest;
 * the first one is what is thrown.
 */
export async function retireThroughPages(
  browser: Browser,
  owner: APIRequestContext,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;

  const context = await browser.newContext({
    baseURL: LIVE_ORIGIN,
    storageState: await owner.storageState(),
  });
  const refusals: unknown[] = [];

  // Outside a test no config applies, and an action would otherwise wait for ever.
  context.setDefaultTimeout(RETIRE_STEP_MS);
  context.on("response", (response) => {
    if (new URL(response.url()).origin === LIVE_ORIGIN) noteAnswer(response);
  });

  try {
    const page = await context.newPage();

    for (const id of ids) {
      try {
        await page.goto(`/dashboard/listings/${encodeURIComponent(id)}`);
        await page.getByRole("button", { name: "Delete listing" }).click();
        await page
          .getByRole("alertdialog", { name: "Delete this listing?" })
          .getByRole("button", { name: "Delete permanently" })
          .click();
        // The action sends the owner back to the dashboard; a refusal keeps the dialog open.
        await page.waitForURL(`${LIVE_ORIGIN}/dashboard`, {
          timeout: RETIRE_STEP_MS,
        });
      } catch (error) {
        refusals.push(
          new Error(`Retiring the listing ${id} failed`, { cause: error }),
        );
      }
    }
  } finally {
    await context.close();
  }

  if (refusals.length > 0) throw refusals[0];
}

/**
 * The guest's stays that can still be cancelled. Only the ones that touch the days from
 * yesterday on are read — a stay over before that cannot be — so the read does not grow
 * with every run the guest has been through.
 */
async function openStays(guest: APIRequestContext): Promise<Booking[]> {
  const utc = { in: tz("UTC") };
  const window = {
    side: "GUEST",
    from: format(addDays(Date.now(), -1, utc), "yyyy-MM-dd", utc),
    to: format(addDays(Date.now(), 730, utc), "yyyy-MM-dd", utc),
    limit: "50",
  };
  const now = new Date();
  const open: Booking[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams(
      cursor === null ? window : { ...window, cursor },
    );
    const page = bookingPageSchema.parse(
      await answered(await guest.get(`/api/bookings?${params.toString()}`)),
    );

    open.push(...page.items.filter((stay) => isCancellableOn(stay, now)));
    cursor = page.nextCursor;
  } while (cursor !== null);

  return open;
}

async function answered(
  response: Awaited<ReturnType<APIRequestContext["get"]>>,
): Promise<unknown> {
  noteAnswer(response);

  if (!response.ok()) {
    throw new Error(
      `${response.url()} was answered ${String(response.status())}: ${await response.text()}`,
    );
  }

  return response.status() === 204 ? null : response.json();
}
