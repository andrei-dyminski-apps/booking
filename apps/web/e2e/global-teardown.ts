import { drainStandInProblems } from "./stripe/stand-in";

/**
 * The last read of the Stripe stand-in's problems: every test drains what surfaced while it
 * ran (`fixtures.ts`), and this takes what the API did after the last one ended — a job that
 * ran on and called Stripe. Runs before Playwright stops the servers.
 */
export default async function globalTeardown(): Promise<void> {
  const problems = await drainStandInProblems();

  if (problems.length > 0) {
    throw new Error(
      `The Stripe stand-in met what it does not play after the last test:\n${problems
        .map((problem) => `- ${problem}`)
        .join("\n")}`,
    );
  }
}
