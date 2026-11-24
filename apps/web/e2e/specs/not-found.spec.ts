import { expect, test } from "../support/fixtures";
import { EVERY_TARGET } from "../target";

test(
  "a broken link shows the not-found page and leads back to the stays",
  { tag: EVERY_TARGET },
  async ({ page, pages }) => {
    pages.expectResponse({ status: 404, path: "/no-such-page" });

    await page.goto("/no-such-page");

    await expect(
      page.getByText("There is nothing at this address"),
    ).toBeVisible();
    await pages.check();

    await page.getByRole("link", { name: "Browse the stays" }).click();

    await expect(page).toHaveURL("/listings");
    await expect(
      page.getByRole("heading", { level: 1, name: "Stays" }),
    ).toBeVisible();
    await pages.check();
  },
);
