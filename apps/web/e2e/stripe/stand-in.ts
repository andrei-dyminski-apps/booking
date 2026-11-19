import type { BrowserContext, Route } from "@playwright/test";
import { STRIPE_STAND_IN_ORIGIN } from "../stack";
import { installStripeStandIn } from "./stripe-js";

/** Every host of Stripe's a page could reach: the script, the API, the frames, the telemetry. */
const STRIPE_HOSTS = /^https:\/\/([a-z0-9-]+\.)*stripe\.(com|network)\//;

/** The script `loadStripe` injects, named by its release train (`/endive/stripe.js`). */
const STRIPE_JS = /^https:\/\/js\.stripe\.com\/([a-z]+)\/stripe\.js(?:\?.*)?$/;

const STRIPE_API = "https://api.stripe.com/";

/**
 * What the browser sends to Stripe goes to the stand-in instead (`server.ts`): the script is
 * Stripe.js as the stand-in plays it, and a call to Stripe's API is answered by the stand-in.
 * Anything else bound for Stripe is refused before it leaves the machine, and the page's
 * failed request fails the test (`fixtures.ts`), so a run never depends on Stripe being
 * reachable and nothing of it reaches Stripe from CI.
 */
export async function routeStripeToStandIn(
  context: BrowserContext,
): Promise<void> {
  await context.route(STRIPE_HOSTS, (route) => standIn(route));
}

/**
 * What the stand-in could not play since it was last asked — a call it does not know, a
 * delivery the API did not take — and forgets them (`server.ts`). Read after every test and
 * once more when the run ends (`global-teardown.ts`), so a background call of the API's that
 * no page shows fails the run as a browser's would.
 */
export async function drainStandInProblems(): Promise<string[]> {
  const response = await fetch(`${STRIPE_STAND_IN_ORIGIN}/problems/drain`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `The Stripe stand-in answered ${String(response.status)} to the problems' drain`,
    );
  }

  const { problems } = (await response.json()) as { problems: string[] };

  return problems;
}

async function standIn(route: Route): Promise<void> {
  const url = route.request().url();
  const script = STRIPE_JS.exec(url);

  if (script !== null) {
    await route.fulfill({
      contentType: "text/javascript",
      body: `(${installStripeStandIn.toString()})(${JSON.stringify(script[1])});`,
    });

    return;
  }

  if (url.startsWith(STRIPE_API)) {
    const response = await route.fetch({
      url: `${STRIPE_STAND_IN_ORIGIN}/${url.slice(STRIPE_API.length)}`,
    });

    await route.fulfill({ response });

    return;
  }

  await route.abort("blockedbyclient");
}
