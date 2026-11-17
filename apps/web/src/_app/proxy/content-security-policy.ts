/** Where Stripe.js, the Connect components and their API calls come from. */
const STRIPE = "https://*.stripe.com";

/** Link, which the Payment Element offers with the payment methods the dashboard manages. */
const LINK = "https://link.com https://*.link.com";

/** Vercel's toolbar and comments, which a preview deployment injects into every page. */
const VERCEL_LIVE = "https://vercel.live";

/**
 * Where a page of this site may load from and talk to: this origin, plus Stripe's hosts for
 * scripts, frames, API calls and images. Scripts need a nonce minted for the request as
 * well — Next.js puts it on its own inline bootstrap, `next-themes` on its theme script —
 * so an injected inline script runs nowhere, which is the point of the policy next to the
 * card fields. `'unsafe-eval'` is development only: React's refresh runtime evaluates code,
 * a production bundle does not. Vercel's toolbar is allowed on a preview deployment only,
 * the one place it is drawn; production stays closed to it.
 */
export function contentSecurityPolicy(
  nonce: string,
  { development, preview }: { development: boolean; preview: boolean },
): string {
  const toolbar = (sources: string): string => (preview ? ` ${sources}` : "");

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ""} https://js.stripe.com https://*.js.stripe.com https://connect-js.stripe.com${toolbar(VERCEL_LIVE)}`,
    `frame-src https://js.stripe.com https://connect-js.stripe.com ${STRIPE} ${LINK}${toolbar(VERCEL_LIVE)}`,
    `connect-src 'self' ${STRIPE} ${LINK}${toolbar(`${VERCEL_LIVE} wss://ws-us3.pusher.com`)}`,
    `img-src 'self' data: blob: ${STRIPE} https://*.link.com${toolbar(`${VERCEL_LIVE} https://vercel.com`)}`,
    // Next.js, Stripe and the theme switch all set inline styles; a style cannot run code.
    `style-src 'self' 'unsafe-inline'${toolbar(VERCEL_LIVE)}`,
    `font-src 'self' data:${toolbar(`${VERCEL_LIVE} https://assets.vercel.com`)}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
