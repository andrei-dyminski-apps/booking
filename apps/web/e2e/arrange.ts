import type {
  APIRequest,
  APIRequestContext,
  APIResponse,
  Browser,
} from "@playwright/test";
import {
  listingListSchema,
  listingSchema,
  type createListingSchema,
  type Listing,
} from "@repo/contracts";
import type { z } from "zod";
import type { Account } from "./demo";
import { liveAccount } from "./live";
import { retireThroughPages } from "./live-demo";
import { noteAnswer, signInSlot } from "./pace";
import { WEB_ORIGIN } from "./stack";
import { TARGET } from "./target";

/**
 * What a listing is created with, as the listing form sends it: the contract's request
 * body, its input side, so a price is the plain number of cents the API is sent.
 */
export type ListingFields = z.input<typeof createListingSchema>;

export type Arrange = {
  /**
   * A listing of this test's own, created before the scenario starts by a host registered
   * for it, and retired when the test ends. No other test books its nights, a retry meets
   * none of the holds its failed attempt left — the retry has a listing of its own, under a
   * title of its own, so a demo guest's stays from the failed attempt never match it — and
   * once retired it is out of the catalogue, where the catalogue's own scenario reads.
   */
  listing(fields?: Partial<ListingFields>): Promise<Listing>;
  /**
   * The test's host, to sign in as in a browser of its own: the owner of every listing
   * `listing()` creates, and an account of the test's own for a scenario that changes one.
   */
  host(): Promise<Account>;
};

const HOST_PASSWORD = "e2e-host-password";

/**
 * State a scenario should not click its way to, arranged by the application's own means —
 * its HTTP surface, through the frontend's BFF as the browser reaches it — and never by
 * writing to its database, so the same arrangement works on every target. Nothing here
 * reaches money: a stay is always paid through the pages.
 *
 * One host per test, registered on first use: creating a listing changes the account that
 * owns it, and the demo accounts are only ever signed in to (`docs/e2e-scenarios.md`). On
 * the deployment, where an account can never be deleted, the host is the suite's own there
 * (`live.ts`), signed in to at the run's pace — the global setup has registered it already.
 */
export function arrangement(
  request: APIRequest,
  browser: Browser,
  address: string,
  name: string,
): { arrange: Arrange; tearDown: () => Promise<void> } {
  let host: APIRequestContext | null = null;
  // New on every attempt: an address once registered stays taken, and a demo guest keeps the
  // stays a failed attempt booked, whose cards would otherwise carry the retry's title too.
  const stamp = Date.now().toString(36);
  const live = TARGET === "live";
  const account: Account = live
    ? liveAccount("host")
    : {
        name: `Host of ${name}`.slice(0, 50),
        email: `host-${address.replaceAll(".", "-")}-${stamp}@e2e.example`,
        password: HOST_PASSWORD,
      };

  const signedInHost = async (): Promise<APIRequestContext> => {
    if (host !== null) return host;

    // An address of the test's own arrangement, so the API's limiter counts it with its
    // test and apart from the test's pages — but on the deployment, where Vercel writes the
    // header itself, the arrangement is the run's one visitor like everything else.
    const context = await request.newContext({
      baseURL: WEB_ORIGIN,
      extraHTTPHeaders: live ? {} : { "x-forwarded-for": address },
    });

    try {
      if (live) {
        await signInSlot();
        await succeeded(
          "signing in as the suite's host",
          await context.post("/api/auth/login", {
            data: { email: account.email, password: account.password },
          }),
        );
      } else {
        await succeeded(
          "registering the test's host",
          await context.post("/api/auth/register", {
            data: account,
          }),
        );
      }
    } catch (error) {
      await context.dispose();
      throw error;
    }

    // Kept only once signed in, so a refused registration is never reused as a host.
    host = context;

    return host;
  };

  const arrange: Arrange = {
    async listing(fields = {}) {
      const owner = await signedInHost();
      const listing = listingSchema.parse(
        await succeeded(
          "creating the test's listing",
          await owner.post("/api/listings", {
            data: {
              title: `${`A stay for ${name}`.slice(0, 89)} · ${stamp}`,
              description:
                "A quiet room the browser suite arranged for one of its scenarios.",
              pricePerNightCents: 10_000,
              capacity: 2,
              ...fields,
            },
          }),
        ),
      );

      return listing;
    },

    async host() {
      await signedInHost();

      return account;
    },
  };

  // Every listing the host still has is retired — the ones a scenario made through the
  // pages too — even when one refusal comes first, and the host's context is let go either
  // way; the first refusal is what the test reports. On the deployment, where the cached
  // pages outlive the run, each goes through its page (`retireThroughPages`), whose action
  // marks the listing's cached reads stale; the local stacks are thrown away with theirs.
  const tearDown = async () => {
    if (host === null) return;

    const owner = host;
    const refusals: unknown[] = [];
    let listings: Listing[] = [];

    try {
      listings = listingListSchema.parse(
        await succeeded(
          "reading the test's listings",
          await owner.get("/api/listings/mine"),
        ),
      );
    } catch (error) {
      refusals.push(error);
    }

    if (live) {
      try {
        await retireThroughPages(
          browser,
          owner,
          listings.map(({ id }) => id),
        );
      } catch (error) {
        refusals.push(error);
      }
    } else {
      for (const { id } of listings) {
        try {
          await succeeded(
            "retiring the test's listing",
            await owner.delete(`/api/listings/${id}`),
          );
        } catch (error) {
          refusals.push(error);
        }
      }
    }

    await owner.dispose();

    if (refusals.length > 0) throw refusals[0];
  };

  return { arrange, tearDown };
}

async function succeeded(
  what: string,
  response: APIResponse,
): Promise<unknown> {
  // On the deployment the arrangement spends the run's budget like its pages (`pace.ts`).
  if (TARGET === "live") noteAnswer(response);

  if (!response.ok()) {
    throw new Error(
      `${what} was refused: ${String(response.status())} ${await response.text()}`,
    );
  }

  return response.status() === 204 ? null : response.json();
}
