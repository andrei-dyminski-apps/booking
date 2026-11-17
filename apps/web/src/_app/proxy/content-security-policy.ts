import { createHash } from "node:crypto";
import { THEME_SCRIPT } from "#shared/config";

/**
 * The one inline script React writes into a prerendered shell itself: it notes when the
 * shell was painted, so the boundaries streamed after it are revealed together rather than
 * one by one. Next.js keeps its own inline scripts out of the shell; this one is React's,
 * and it is written while prerendering, with no request and so with no nonce. Blocked, it
 * changes nothing a visitor sees and costs a console error on every page — so it is allowed
 * by its text, which `proxy.spec.ts` checks against the React that Next.js runs.
 */
export const REACT_SHELL_TIME_SCRIPT =
  "requestAnimationFrame(function(){$RT=performance.now()});";

/**
 * Inline scripts allowed by what they say rather than by a nonce: both are part of the
 * prerendered shell, which is written before any request has a nonce to hand it.
 */
const SHELL_SCRIPT_HASHES = [THEME_SCRIPT, REACT_SHELL_TIME_SCRIPT]
  .map(
    (script) =>
      `'sha256-${createHash("sha256").update(script).digest("base64")}'`,
  )
  .join(" ");

/** Where Stripe.js, the Connect components and their API calls come from. */
const STRIPE = "https://*.stripe.com";

/** Link, which the Payment Element offers with the payment methods the dashboard manages. */
const LINK = "https://link.com https://*.link.com";

/** Vercel's toolbar and comments, which a preview deployment injects into every page. */
const VERCEL_LIVE = "https://vercel.live";

/**
 * Where a page of this site may load from and talk to: this origin, plus Stripe's hosts for
 * scripts, frames, API calls and images. An inline script needs a nonce minted for the
 * request — Next.js puts it on the scripts it streams after the prerendered shell — or is
 * one of the two in the shell itself, allowed by its hash; so an injected inline script runs nowhere, which is
 * the point of the policy next to the card fields. `'unsafe-eval'` is development only: React's refresh runtime evaluates code,
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
    `script-src 'self' 'nonce-${nonce}' ${SHELL_SCRIPT_HASHES}${development ? " 'unsafe-eval'" : ""} https://js.stripe.com https://*.js.stripe.com https://connect-js.stripe.com${toolbar(VERCEL_LIVE)}`,
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
