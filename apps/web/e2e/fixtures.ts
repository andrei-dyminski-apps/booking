import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { arrangement, type Arrange } from "./arrange";
import { STRIPE_STAND_IN_ORIGIN, WEB_ORIGIN } from "./stack";
import { drainStandInProblems, routeStripeToStandIn } from "./stripe/stand-in";

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
  /** Watches the pages of a context besides the test's own — another visitor's. */
  watch(context: BrowserContext): void;
};

/**
 * Another person at the same time, in a browser of their own (`docs/e2e-scenarios.md`):
 * a page in a fresh context, with no session, its own address and the same rules for
 * every page it opens. Closed when the test ends.
 */
export type Another = () => Promise<Page>;

type Problem = { what: string; url: string; status?: number };

/** Every rule axe runs; a violation fails the page at these impacts only. */
const FAILING_IMPACTS = new Set(["serious", "critical"]);

/**
 * The rule every scenario follows (`docs/e2e-scenarios.md`): each page a test visits opens
 * with no console error and no failed request, and passes the accessibility check. The
 * errors are collected for the whole test and asserted when it ends; a page reached and
 * never `check`ed fails the test as well, so the rule cannot be forgotten in a new one.
 */
export const test = base.extend<{
  pages: Pages;
  arrange: Arrange;
  another: Another;
}>({
  context: async ({ context }, use, testInfo) => {
    await prepare(context, clientAddressOf(testInfo));
    await use(context);
  },

  another: async ({ browser, pages }, use, testInfo) => {
    const contexts: BrowserContext[] = [];

    await use(async () => {
      // Created inside the test, so with the project's options, as the test's own is.
      const context = await browser.newContext();

      contexts.push(context);
      await prepare(context, clientAddressOf(testInfo, contexts.length));
      pages.watch(context);

      return context.newPage();
    });

    for (const context of contexts) await context.close();
  },

  arrange: async ({ playwright }, use, testInfo) => {
    const { arrange, tearDown } = arrangement(
      playwright.request,
      clientAddressOf(testInfo, "arrangement"),
      testInfo.title,
    );

    await use(arrange);
    await tearDown();
  },

  pages: [
    async ({ page, context }, use, testInfo) => {
      const problems: Problem[] = [];
      const expected: ExpectedResponse[] = [];
      // Per page, not per path: a path one visitor's page passed says nothing about the
      // same path in another visitor's browser, which renders it for somebody else.
      const visits = new Map<
        Page,
        { visited: Set<string>; checked: Set<string> }
      >();

      const watch = (watched: Page) => {
        const visit = {
          visited: new Set<string>(),
          checked: new Set<string>(),
        };

        visits.set(watched, visit);
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
            visit.visited.add(pathOf(frame.url()));
          }
        });
      };

      watch(page);
      context.on("page", watch);

      await use({
        async check(checkedPage = page) {
          const visit = visits.get(checkedPage);

          // A page nobody watches has had its errors go uncollected, so passing it here would
          // say it was checked when half the check never ran.
          if (visit === undefined) {
            throw new Error(
              `${checkedPage.url()} is not watched by the fixture: open another visitor's page with another()`,
            );
          }

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

          visit.checked.add(pathOf(checkedPage.url()));
        },

        expectResponse(response) {
          expected.push(response);
        },

        watch(other) {
          other.on("page", watch);
        },
      });

      // What the stand-in met while this test ran, the API's background calls included —
      // drained whatever the outcome. The drain first waits for the webhook deliveries the
      // test set going (a refund reported a moment late, a retry), so those are laid at this
      // test's door rather than the next's; a call the API makes later still, from a job
      // that ran on, is caught by the next drain or the global teardown.
      for (const line of await drainStandInProblems()) {
        problems.push({
          what: `Stripe stand-in: ${line}`,
          url: STRIPE_STAND_IN_ORIGIN,
        });
      }

      const unexpected = problems.filter(
        (problem) => !expected.some((response) => answers(response, problem)),
      );
      const report = unexpected
        .map((problem) => `- ${problem.what} (${problem.url})`)
        .join("\n");
      const unchecked = [...visits.values()].flatMap(({ visited, checked }) =>
        [...visited].filter((path) => !checked.has(path)),
      );

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

/**
 * Prepares a context the way every page of the suite is seen.
 *
 * An address of its own for each attempt of each test — and for each visitor of it — in
 * the header the frontend passes on and the stack's API believes (`TRUST_PROXY` in
 * `stack.ts`): the rate limiter then counts every test apart, and a retry starts with none
 * of the first attempt's requests.
 *
 * Added by a route on the frontend's origin rather than `extraHTTPHeaders`, which the
 * browser sends to every origin: on a request elsewhere (Stripe's, once a scenario pays) a
 * header outside the CORS safelist forces a preflight the other side may refuse, and the
 * address is nobody else's business. A route does not see `page.request`, so a test reads
 * the API through the page instead (`page.evaluate` with `fetch`).
 */
async function prepare(
  context: BrowserContext,
  address: string,
): Promise<void> {
  await context.route(
    (url) => url.origin === WEB_ORIGIN,
    (route) =>
      route.continue({
        headers: { ...route.request().headers(), "x-forwarded-for": address },
      }),
  );
  await routeStripeToStandIn(context);
}

/**
 * A private address derived from the test, its attempt and which of its visitors it is
 * (`0` for the test's own page, `"arrangement"` for the state arranged before it): stable
 * for all three, apart for each. The arrangement has one of its own because a scenario
 * that arranges a lot — the catalogue's twenty-one listings, created and retired — would
 * otherwise spend most of the API's per-minute limit its own pages count against.
 */
function clientAddressOf(
  testInfo: TestInfo,
  visitor: number | "arrangement" = 0,
): string {
  const [a = 0, b = 0, c = 0] = createHash("sha256")
    .update(`${testInfo.testId}:${String(testInfo.retry)}:${String(visitor)}`)
    .digest();

  return `10.${a}.${b}.${c}`;
}
