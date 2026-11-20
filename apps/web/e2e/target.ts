/**
 * Which stack the suite runs against, by `E2E_TARGET` (`docs/e2e-scenarios.md`, "How to
 * read a scenario"):
 *
 * - `hermetic`, the default and the required check: the stack of `stack.ts` with Stripe
 *   played by the stand-in (`stripe/`), every scenario but the ones for real Stripe only.
 * - `stripe`: the same stack with Stripe's side real — the sandbox the root `.env` names,
 *   its events brought back by `stripe listen` — running the scenarios marked for every
 *   target and for real Stripe only. How a developer checks the payment and payout paths
 *   against Stripe; never in CI and never retried, since a failure on Stripe's side is what
 *   it exists to show.
 */
export type Target = "hermetic" | "stripe";

export const TARGET: Target = targetOf(process.env.E2E_TARGET);

/** A scenario that runs on every target: the hermetic stack, real Stripe, the deployment. */
export const EVERY_TARGET = "@every-target";

/** A scenario only real Stripe can answer — the payout account is opened with Stripe. */
export const REAL_STRIPE_ONLY = "@real-stripe-only";

/**
 * A wait on Stripe's news — a payment confirmed, a refund recorded — on this target. The
 * stand-in reports a step a moment after its answer; Stripe's events come back through
 * `stripe listen` and the API's queue, and the page sees them at its next poll, which on a
 * cold sandbox has taken several times as long.
 */
export function providerWait(hermeticMs: number): number {
  return TARGET === "stripe" ? hermeticMs * 3 : hermeticMs;
}

// An untagged scenario is the hermetic stack's alone, so one written without a thought for
// the other targets never reaches Stripe or a deployment.

function targetOf(value: string | undefined): Target {
  if (value === undefined || value === "" || value === "hermetic") {
    return "hermetic";
  }

  if (value === "stripe") return "stripe";

  throw new Error(
    `E2E_TARGET is "hermetic" (the default) or "stripe", not "${value}"`,
  );
}
