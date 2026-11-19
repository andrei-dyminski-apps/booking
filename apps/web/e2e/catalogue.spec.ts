import { randomInt } from "node:crypto";
import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** One more than a page of the catalogue holds, so the search runs onto a second. */
const LISTINGS = 21;

test("a visitor filters and orders the stays, keeps the search through a reload and a link, pages on and opens a stay", async ({
  page,
  pages,
  arrange,
  another,
}) => {
  // The test's own stays, a cent apart at a price no other listing has: a search for that
  // price is a catalogue address nobody else has read, so nothing cached answers it, and
  // its answer is these listings and nothing else.
  const dollars = randomInt(500, 900);
  const base = dollars * 100;
  const listings = [];

  for (let index = 0; index < LISTINGS; index += 1) {
    listings.push(
      await arrange.listing({
        title: `Catalogue stay ${String(index + 1)} at $${String(dollars)}`,
        pricePerNightCents: base + index,
      }),
    );
  }

  const cheapest = listings[0];
  const dearest = listings[LISTINGS - 1];

  if (cheapest === undefined || dearest === undefined) {
    throw new Error("No listings were arranged");
  }

  await page.goto("/");
  await pages.check();
  await page.getByRole("link", { name: "Browse the stays" }).click();

  await expect(page).toHaveURL("/listings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Stays" }),
  ).toBeVisible();
  await pages.check();

  await page.getByRole("button", { name: "Filters" }).click();

  const dialog = page.getByRole("dialog", { name: "Filter the catalogue" });

  await dialog
    .getByRole("spinbutton", { name: "Price from" })
    .fill(String(dollars));
  await dialog
    .getByRole("spinbutton", { name: "Price to" })
    .fill(`${String(dollars)}.20`);
  await pages.check();
  await dialog.getByRole("button", { name: "Show stays" }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(
    `/listings?minPrice=${String(dollars)}&maxPrice=${String(dollars)}.20`,
  );
  await expect(
    page.getByRole("link", { name: `From $${String(dollars)}.00 a night` }),
  ).toBeVisible();
  await expect(stays(page)).toHaveCount(20);
  await pages.check();

  await page.getByRole("combobox", { name: "Sort by" }).click();
  await page.getByRole("option", { name: "Price: low to high" }).click();

  const ordered = `/listings?minPrice=${String(dollars)}&maxPrice=${String(dollars)}.20&sort=priceAsc`;

  await expect(page).toHaveURL(ordered);
  await expectFirstStay(page, cheapest.title);
  await pages.check();

  // The search lives in the address: a reload, and the same link opened by somebody else
  // in a browser of their own, show the same stays in the same order.
  await page.reload();
  await expectFirstStay(page, cheapest.title);
  await pages.check();

  const shared = await another();

  await shared.goto(ordered);
  await expectFirstStay(shared, cheapest.title);
  await expect(stays(shared)).toHaveCount(20);
  await pages.check(shared);

  // The twenty-first, dearest of them, is on the next page, and only it.
  await page.getByRole("link", { name: "Next page" }).click();

  await expect(stays(page)).toHaveCount(1);
  await expectFirstStay(page, dearest.title);
  await pages.check();

  await page.getByRole("link", { name: dearest.title }).click();

  await expect(page).toHaveURL(`/listings/${dearest.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: dearest.title }),
  ).toBeVisible();
  await expect(page.getByText(`$${String(dollars)}.20 a night`)).toBeVisible();
  await pages.check();
});

/** The stays the catalogue lists, each a card in the list under the toolbar. */
function stays(page: Page) {
  return page.getByRole("main").getByRole("listitem");
}

async function expectFirstStay(page: Page, title: string): Promise<void> {
  await expect(
    stays(page).first().getByRole("link", { name: title }),
  ).toBeVisible();
}
