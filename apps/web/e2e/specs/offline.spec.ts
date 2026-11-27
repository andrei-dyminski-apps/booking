import { expect, test } from "../support/fixtures";

// The one scenario the worker is let in for — see `serviceWorkers` in playwright.config.ts.
test.use({ serviceWorkers: "allow" });

test("a visitor who loses the connection is shown the offline page, and gets back with a retry", async ({
  page,
  context,
  pages,
}) => {
  await page.goto("/listings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Stays" }),
  ).toBeVisible();
  await pages.check();

  // Installed and in charge of the page once it is active: it claims the open tabs.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();

  await expect(
    page.getByRole("heading", { level: 1, name: "You are offline" }),
  ).toBeVisible();
  await pages.check();

  await context.setOffline(false);
  await page.getByRole("link", { name: "Try again" }).click();

  await expect(page).toHaveURL("/listings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Stays" }),
  ).toBeVisible();
  await pages.check();
});
