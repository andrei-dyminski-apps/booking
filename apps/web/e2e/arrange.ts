import type {
  APIRequest,
  APIRequestContext,
  APIResponse,
} from "@playwright/test";
import {
  listingSchema,
  type createListingSchema,
  type Listing,
} from "@repo/contracts";
import type { z } from "zod";
import { WEB_ORIGIN } from "./stack";

/**
 * What a listing is created with, as the listing form sends it: the contract's request
 * body, its input side, so a price is the plain number of cents the API is sent.
 */
export type ListingFields = z.input<typeof createListingSchema>;

export type Arrange = {
  /**
   * A listing of this test's own, created before the scenario starts by a host registered
   * for it, and retired when the test ends. No other test books its nights, a retry meets
   * none of the holds its failed attempt left — the retry has a listing of its own — and
   * once retired it is out of the catalogue, where the catalogue's own scenario reads.
   */
  listing(fields?: Partial<ListingFields>): Promise<Listing>;
};

const HOST_PASSWORD = "e2e-host-password";

/**
 * State a scenario should not click its way to, arranged by the application's own means —
 * its HTTP surface, through the frontend's BFF as the browser reaches it — and never by
 * writing to its database, so the same arrangement works on every target. Nothing here
 * reaches money: a stay is always paid through the pages.
 *
 * One host per test, registered on first use: creating a listing changes the account that
 * owns it, and the demo accounts are only ever signed in to (`docs/e2e-scenarios.md`).
 */
export function arrangement(
  request: APIRequest,
  address: string,
  name: string,
): { arrange: Arrange; tearDown: () => Promise<void> } {
  let host: APIRequestContext | null = null;
  const listings: string[] = [];

  const signedInHost = async (): Promise<APIRequestContext> => {
    if (host !== null) return host;

    // The test's own address, so the API's limiter counts the arrangement with its test.
    const context = await request.newContext({
      baseURL: WEB_ORIGIN,
      extraHTTPHeaders: { "x-forwarded-for": address },
    });

    try {
      await succeeded(
        "registering the test's host",
        await context.post("/api/auth/register", {
          data: {
            name: `Host of ${name}`.slice(0, 50),
            email: `host-${address.replaceAll(".", "-")}-${String(Date.now())}@e2e.example`,
            password: HOST_PASSWORD,
          },
        }),
      );
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
              title: `A stay for ${name}`.slice(0, 100),
              description:
                "A quiet room the browser suite arranged for one of its scenarios.",
              pricePerNightCents: 10_000,
              capacity: 2,
              ...fields,
            },
          }),
        ),
      );

      listings.push(listing.id);

      return listing;
    },
  };

  // Every listing is retired even when one refusal comes first, and the host's context
  // is let go either way; the first refusal is what the test reports.
  const tearDown = async () => {
    if (host === null) return;

    const owner = host;
    const refusals: unknown[] = [];

    for (const id of listings) {
      try {
        await succeeded(
          "retiring the test's listing",
          await owner.delete(`/api/listings/${id}`),
        );
      } catch (error) {
        refusals.push(error);
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
  if (!response.ok()) {
    throw new Error(
      `${what} was refused: ${String(response.status())} ${await response.text()}`,
    );
  }

  return response.status() === 204 ? null : response.json();
}
