import { randomInt } from "node:crypto";
import { expectInCatalogue } from "./catalogue";
import { expect, test } from "./fixtures";
import { EVERY_TARGET } from "./target";
import { signInThroughForm } from "./session";
import { sidebarLink } from "./shell";

test(
  "a host creates a listing, edits it and deletes it, and the catalogue follows each change",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange }) => {
    const host = await arrange.host();
    // A price no other listing has, so the catalogue's search for it is the host's listing
    // alone, at an address nothing else has read.
    const dollars = randomInt(1_000, 2_000);
    const search = `/listings?minPrice=${String(dollars)}&maxPrice=${String(dollars)}`;
    const title = `Boathouse at $${String(dollars)}`;
    const renamed = `Boathouse with a new roof at $${String(dollars)}`;

    await page.goto("/login?next=/dashboard");
    await pages.check();
    await signInThroughForm(page, host);

    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();
    await expect(page.getByText("No listings yet")).toBeVisible();
    await pages.check();

    // Created.
    await page.getByRole("link", { name: "New listing" }).first().click();
    await expect(page).toHaveURL("/dashboard/listings/new");
    await pages.check();

    await page.getByLabel("Title", { exact: true }).fill(title);
    await page
      .getByLabel("Description", { exact: true })
      .fill("A room over the water, with a ladder down to it.");
    await page
      .getByLabel("Default price per night", { exact: true })
      .fill(String(dollars));
    await page.getByLabel("Capacity", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Create listing" }).click();

    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await pages.check();

    await expectInCatalogue(page, pages, search, title);

    // Edited.
    await sidebarLink(page, "Dashboard").click();
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/listings\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(title);
    await pages.check();

    await page.getByLabel("Title", { exact: true }).fill(renamed);
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByText(renamed, { exact: true })).toBeVisible();
    await pages.check();

    await expectInCatalogue(page, pages, search, renamed);

    // Deleted.
    await sidebarLink(page, "Dashboard").click();
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      renamed,
    );
    await pages.check();

    await page.getByRole("button", { name: "Delete listing" }).click();

    const dialog = page.getByRole("alertdialog", {
      name: "Delete this listing?",
    });

    await expect(dialog).toBeVisible();
    await pages.check();
    await dialog.getByRole("button", { name: "Delete permanently" }).click();

    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByText("No listings yet")).toBeVisible();
    await pages.check();

    await expectInCatalogue(page, pages, search, null);
  },
);
