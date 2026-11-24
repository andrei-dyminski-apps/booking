import { randomInt } from "node:crypto";
import { expectInCatalogue } from "../support/catalogue";
import { DEMO } from "../support/demo";
import { expect, test } from "../support/fixtures";
import { signInThroughForm } from "../support/session";
import { sidebarLink } from "../support/shell";

test("the admin finds a listing in the admin's list, changes it, and the catalogue shows the change", async ({
  page,
  pages,
  arrange,
}) => {
  // A price no other listing has, so a search for it finds this one alone.
  const dollars = randomInt(2_000, 3_000);
  const listing = await arrange.listing({
    title: `Granary at $${String(dollars)}`,
    pricePerNightCents: dollars * 100,
  });
  const renamed = `Granary, as the site renamed it, at $${String(dollars)}`;
  const search = `/listings?minPrice=${String(dollars)}&maxPrice=${String(dollars)}`;

  await page.goto("/login");
  await pages.check();
  await signInThroughForm(page, DEMO.admin);
  await expect(page).toHaveURL("/profile");
  await pages.check();

  await sidebarLink(page, "Listings").click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Listings" }),
  ).toBeVisible();
  await pages.check();

  await page.getByRole("button", { name: "Filters" }).click();

  const dialog = page.getByRole("dialog", { name: "Filter the listings" });

  await dialog
    .getByRole("spinbutton", { name: "Price from" })
    .fill(String(dollars));
  await dialog
    .getByRole("spinbutton", { name: "Price to" })
    .fill(String(dollars));
  await pages.check();
  await dialog.getByRole("button", { name: "Show listings" }).click();

  await expect(dialog).toBeHidden();

  const found = page.getByRole("main").getByRole("listitem");

  await expect(found).toHaveCount(1);
  await expect(found).toContainText(listing.title);
  await pages.check();

  await found.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    listing.title,
  );
  await pages.check();

  await page.getByLabel("Title", { exact: true }).fill(renamed);
  await page.getByRole("button", { name: "Save changes" }).click();

  // Back on the admin's list, which shows the new title.
  await expect(page).toHaveURL(/^[^?]*\/admin(\?|$)/);
  await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  await pages.check();

  await expectInCatalogue(page, pages, search, renamed);
});
