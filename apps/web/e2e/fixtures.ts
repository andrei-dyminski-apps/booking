import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { WEB_ORIGIN } from "./stack";

/**
 * A response a test provokes on purpose — the not-found page, a refusal of a role. Declared
 * by the test before the step that provokes it, and then neither the response nor the
 * console line the browser writes about it is a failure.
 */
export type ExpectedResponse = {
  status: number;
  /** The path the response answers, without the query: `/no-such-page`. */
  path: string | RegExp;
};

export type Pages = {
  /**
   * Runs the accessibility check on the page as it is now, and marks its path checked.
   * Called once the test has seen the page's content, so the check reads what the visitor
   * reads rather than a skeleton.
   */
  check(page?: Page): Promise<void>;
  expectResponse(response: ExpectedResponse): void;
};

type Problem = { what: string; url: string; status?: number };

/** Every rule axe runs; a violation fails the page at these impacts only. */
const FAILING_IMPACTS = new Set(["serious", "critical"]);

/**
 * The rule every scenario follows (`docs/e2e-scenarios.md`): each page a test visits opens
 * with no console error and no failed request, and passes the accessibility check. The
 * errors are collected for the whole test and asserted when it ends; a page reached and
 * never `check`ed fails the test as well, so the rule cannot be forgotten in a new one.
 */
export const test = base.extend<{ pages: Pages }>({
  // An address of its own for each attempt of each test, in the header the frontend passes
  // on and the stack's API believes (`TRUST_PROXY` in `stack.ts`): the rate limiter then
  // counts every test apart, and a retry starts with none of the first attempt's requests.
  //
  // Added by a route on the frontend's origin rather than `extraHTTPHeaders`, which the
  // browser sends to every origin: on a request elsewhere (Stripe's, once a scenario pays)
  // a header outside the CORS safelist forces a preflight the other side may refuse, and
  // the address is nobody else's business. A route does not see `page.request`, so a test
  // reads the API through the page instead (`page.evaluate` with `fetch`).
  context: async ({ context }, use, testInfo) => {
    const address = clientAddressOf(testInfo);

    await context.route(
      (url) => url.origin === WEB_ORIGIN,
      (route) =>
        route.continue({
          headers: { ...route.request().headers(), "x-forwarded-for": address },
        }),
    );
    await use(context);
  },

  pages: [
    async ({ page, context }, use, testInfo) => {
      const problems: Problem[] = [];
      const expected: ExpectedResponse[] = [];
      const visited = new Set<string>();
      const checked = new Set<string>();

      const watch = (watched: Page) => {
        watched.on("console", (message) => {
          if (message.type() !== "error") return;

          problems.push({
            what: `console: ${message.text()}`,
            url: message.location().url,
          });
        });
        watched.on("pageerror", (error) => {
          problems.push({
            what: `uncaught: ${error.message}`,
            url: watched.url(),
          });
        });
        watched.on("response", (response) => {
          if (response.status() < 400) return;

          problems.push({
            what: `response ${response.status()}`,
            url: response.url(),
            status: response.status(),
          });
        });
        watched.on("requestfailed", (request) => {
          const failure = request.failure()?.errorText ?? "failed";

          // A request the page itself gave up on — a prefetch overtaken by a click, the event
          // stream closed by a navigation — is the browser working as intended.
          if (failure === "net::ERR_ABORTED") return;

          problems.push({ what: `request ${failure}`, url: request.url() });
        });
        watched.on("framenavigated", (frame) => {
          if (frame === watched.mainFrame() && frame.url().startsWith("http")) {
            visited.add(pathOf(frame.url()));
          }
        });
      };

      watch(page);
      context.on("page", watch);

      await use({
        async check(checkedPage = page) {
          // The pointer stays wherever the last click left it, and whatever lies under it on
          // the next page is drawn hovered — so the same page would read differently from
          // one run to the next. Every page is read with the pointer in the same corner.
          await checkedPage.mouse.move(0, 0);

          // A transition in flight is read at whatever frame it has reached: a link React
          // keeps across a render and hands new classes (the account panel after signing
          // out) fades between two colour pairs, and a contrast check halfway through fails
          // a page that is fine at rest. So every finite animation — the pointer's leaving
          // included — is let finish first; an endless one (a spinner) never would.
          await checkedPage.evaluate(() =>
            Promise.all(
              document
                .getAnimations()
                .filter(
                  (animation) =>
                    animation.effect?.getComputedTiming().endTime !== Infinity,
                )
                .map((animation) => animation.finished.catch(() => undefined)),
            ),
          );

          const results = await new AxeBuilder({ page: checkedPage }).analyze();
          const violations = results.violations.filter(
            (violation) =>
              violation.impact != null && FAILING_IMPACTS.has(violation.impact),
          );

          expect(
            violations,
            `accessibility of ${checkedPage.url()}:\n${violations
              .map(
                (violation) =>
                  `- ${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes
                    .map((node) => node.target.join(" "))
                    .join(", ")}`,
              )
              .join("\n")}`,
          ).toEqual([]);

          checked.add(pathOf(checkedPage.url()));
        },

        expectResponse(response) {
          expected.push(response);
        },
      });

      const unexpected = problems.filter(
        (problem) => !expected.some((response) => answers(response, problem)),
      );
      const report = unexpected
        .map((problem) => `- ${problem.what} (${problem.url})`)
        .join("\n");
      const unchecked = [...visited].filter((path) => !checked.has(path));

      if (testInfo.status !== testInfo.expectedStatus) {
        // The test failed on its own already; what else went wrong goes beside it, not over it.
        if (report !== "") {
          await testInfo.attach("page errors", { body: report });
        }

        return;
      }

      expect(unexpected, `errors on the pages visited:\n${report}`).toEqual([]);
      expect(unchecked, "pages visited and never checked").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

function pathOf(url: string): string {
  return new URL(url).pathname;
}

/**
 * Whether a problem is the declared response or what the browser says about it: a failed
 * document or fetch is also written to the console as "Failed to load resource", located
 * at the URL that failed.
 */
function answers(response: ExpectedResponse, problem: Problem): boolean {
  if (problem.url === "") return false;

  const path = pathOf(problem.url);
  const pathMatches =
    typeof response.path === "string"
      ? path === response.path
      : response.path.test(path);

  if (!pathMatches) return false;

  return (
    problem.status === response.status ||
    (problem.status === undefined &&
      problem.what.includes(`status of ${response.status}`))
  );
}

/** A private address derived from the test and its attempt: stable for both, apart for each. */
function clientAddressOf(testInfo: TestInfo): string {
  const [a = 0, b = 0, c = 0] = createHash("sha256")
    .update(`${testInfo.testId}:${testInfo.retry}`)
    .digest();

  return `10.${a}.${b}.${c}`;
}
