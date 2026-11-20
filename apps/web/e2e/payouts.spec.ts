import { expect, test } from "./fixtures";
import { signInThroughForm } from "./session";
import { REAL_STRIPE_ONLY } from "./target";

test(
  "a host who has not set up payouts is told so, picks the country of the account and is handed over to Stripe's onboarding",
  {
    tag: REAL_STRIPE_ONLY,
  },
  async ({ page, pages, arrange }) => {
    // A host of the test's own: opening the payout account changes it, for good — Stripe keeps
    // the account, and the application has no way to close one. The dashboard asks a host to
    // set up payouts once they have a listing to be paid for.
    await arrange.listing();
    const host = await arrange.host();

    await page.goto("/login?next=/dashboard");
    await pages.check();
    await signInThroughForm(page, host);

    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByText("Set up payouts to get paid")).toBeVisible();
    await pages.check();

    await page
      .getByRole("link", { name: "Set up payouts", exact: true })
      .click();

    await expect(page).toHaveURL("/dashboard/payouts");
    await expect(
      page.getByRole("heading", { level: 1, name: "Payouts" }),
    ).toBeVisible();

    // The countries are the API's snapshot of Stripe's list for the platform, streamed in
    // after the heading.
    await expect(
      page.getByRole("heading", { level: 2, name: "Set up payouts" }),
    ).toBeVisible();
    await page.getByLabel("Country", { exact: true }).click();
    await page.getByRole("option", { name: "United States" }).click();
    await expect(page.getByLabel("Country", { exact: true })).toContainText(
      "United States",
    );
    await pages.check();

    await page.getByRole("button", { name: "Continue" }).click();

    // The account is opened with Stripe — several seconds — and the page hands over to
    // Stripe's embedded onboarding, whose inside is Stripe's and not this suite's.
    await expect(
      page.getByRole("heading", { level: 2, name: "Set up payouts" }),
    ).toBeHidden({ timeout: 20_000 });
    await expect(
      page.locator('iframe[src^="https://connect-js.stripe.com/"]').first(),
    ).toBeVisible({ timeout: 20_000 });
    await pages.check();
  },
);
