/**
 * The publishable key Stripe.js is loaded with in the browser. Publishable means safe to
 * show — it can create a payment method and nothing else — but it is still read on the
 * server, on demand, and handed to the payment form as a prop, for the reason `apiOrigin`
 * is: a `NEXT_PUBLIC_` variable is inlined at `next build`, which would make switching the
 * account (test to live) a rebuild rather than a restart.
 *
 * No fallback, as for the API's address: a missing key fails the page that needs it with
 * its own name in the message rather than drawing a payment form that cannot load.
 */
export function stripePublishableKey(): string {
  const value = process.env.STRIPE_PUBLISHABLE_KEY;

  if (!value) {
    throw new Error(
      "STRIPE_PUBLISHABLE_KEY is not set. Copy .env.example to .env in the repository root.",
    );
  }

  return value;
}

/**
 * The site's tokens as Stripe's iframes are handed them. An iframe cannot read this
 * page's CSS variables, so the values are copied out of `@repo/ui/globals.css` — the hex
 * of its `oklch()`, which Stripe does not parse — and both of Stripe's surfaces, the
 * payment form and the payouts components, are drawn from this one copy rather than each
 * guessing its own. A change of the palette there is a change here too.
 */
export function stripeVariables(theme: string | undefined): {
  colorBackground: string;
  colorText: string;
  colorPrimary: string;
  colorDanger: string;
  borderRadius: string;
} {
  return theme === "dark"
    ? {
        colorBackground: "#0a0a0a",
        colorText: "#fafafa",
        colorPrimary: "#e5e5e5",
        colorDanger: "#ff6467",
        borderRadius: "10px",
      }
    : {
        colorBackground: "#ffffff",
        colorText: "#0a0a0a",
        colorPrimary: "#171717",
        colorDanger: "#e7000b",
        borderRadius: "10px",
      };
}
