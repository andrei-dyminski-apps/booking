import { defineConfig } from "vitest/config";

/**
 * Only the pure logic of this package is covered here, and deliberately so: what this
 * config needs a runner for is a function whose input somebody else writes and whose
 * failure a reviewer cannot re-check on every change — a parser (`next-path.ts`,
 * `session-cookies.ts`), a security gate (`proxy.ts`), or an invariant with a real way to
 * get it wrong under concurrency or a malformed answer (the single-flight session refresh
 * and retry-on-401 in `http-client.ts`). See "Tests" in `apps/web/CLAUDE.md` for
 * the rule this config exists to run.
 *
 * Rendering is not tested and needs no `jsdom`: a component that would break here is one
 * `check-types` and Steiger already refuse.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
