import { DEMO } from "./demo";
import { expect, test } from "./fixtures";
import { signInToListing } from "./session";
import { dayIn, holdAndPay } from "./stay";

test("a guest reads a listing, holds the nights, pays and lands on a confirmed stay", async ({
  page,
  pages,
  arrange,
}) => {
  const listing = await arrange.listing({ pricePerNightCents: 12_000 });
  const from = dayIn(listing.timeZone, 14);
  const to = dayIn(listing.timeZone, 17);

  await signInToListing(page, pages, DEMO.guest, listing);

  // The listing: what it is, what a night costs, and which nights are free.
  await expect(page.getByText("$120.00 a night")).toBeVisible();
  await expect(
    page.getByText("A quiet room the browser suite arranged"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Availability" }),
  ).toBeVisible();
  await pages.check();

  await holdAndPay(page, pages, { from, to, total: "$360.00" });
});
