import { randomInt } from "node:crypto";
import { DEMO } from "../support/demo";
import { expect, test } from "../support/fixtures";
import { signInThroughForm, signInToListing } from "../support/session";
import { sidebarLink } from "../support/shell";
import { dayIn, holdAndPay } from "../support/stay";

test("the admin finds a paid stay through its listing and refunds part of it, and the amounts follow", async ({
  page,
  pages,
  arrange,
  another,
}) => {
  // A price no other listing has, so the admin's search for it finds this one alone: above
  // the seed's dearest ($210) and below the catalogue scenario's ($500 up), and under $500
  // so the total of two nights is written without a thousands separator.
  const dollars = randomInt(300, 500);
  const listing = await arrange.listing({ pricePerNightCents: dollars * 100 });
  const total = `$${String(dollars * 2)}.00`;

  await signInToListing(page, pages, DEMO.guest, listing);
  await holdAndPay(page, pages, {
    from: dayIn(listing.timeZone, 30),
    to: dayIn(listing.timeZone, 32),
    total,
  });

  const admin = await another();

  await admin.goto("/login");
  await pages.check(admin);
  await signInThroughForm(admin, DEMO.admin);
  await expect(admin).toHaveURL("/profile");
  await pages.check(admin);

  // The listing in the admin's list, and the stays taken against it.
  await sidebarLink(admin, "Listings").click();
  await admin.getByRole("button", { name: "Filters" }).click();

  const filters = admin.getByRole("dialog", { name: "Filter the listings" });

  await filters
    .getByRole("spinbutton", { name: "Price from" })
    .fill(String(dollars));
  await filters
    .getByRole("spinbutton", { name: "Price to" })
    .fill(String(dollars));
  await pages.check(admin);
  await filters.getByRole("button", { name: "Show listings" }).click();
  await expect(filters).toBeHidden();
  await expect(admin.getByText(listing.title, { exact: true })).toBeVisible();
  await pages.check(admin);

  await admin
    .getByRole("main")
    .getByRole("listitem")
    .getByRole("link", { name: "Stays", exact: true })
    .click();
  await expect(
    admin.getByRole("heading", { level: 1, name: "All bookings" }),
  ).toBeVisible();

  const stay = admin
    .getByRole("listitem")
    .filter({ has: admin.getByRole("link", { name: listing.title }) });

  await expect(stay).toHaveCount(1);
  await expect(stay).toContainText(total);
  await pages.check(admin);

  await stay.getByRole("link", { name: "Details" }).click();
  await expect(
    admin.getByRole("heading", { level: 1, name: listing.title }),
  ).toBeVisible();
  await pages.check(admin);

  await admin.getByRole("button", { name: "Refund part" }).click();

  const dialog = admin.getByRole("dialog", {
    name: "Refund part of this stay?",
  });

  // All of it but the last cent: the stay has not begun, and refunding all of it is
  // cancelling it.
  await expect(dialog).toContainText(
    `At most $${String(dollars * 2 - 1)}.99 is left to refund`,
  );
  await dialog.getByLabel("Amount", { exact: true }).fill("50");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("The heating was out for a night.");
  await pages.check(admin);
  await dialog.getByRole("button", { name: "Send the refund" }).click();

  await expect(dialog).toBeHidden();

  // The refund under the stay, by whom and why, and the stay's refund total once Stripe
  // reports it.
  const refund = admin
    .getByRole("listitem")
    .filter({ hasText: `$50.00 by ${DEMO.admin.name}` });

  await expect(admin.getByText("Refunds by admins")).toBeVisible();
  await expect(refund).toContainText("“The heating was out for a night.”");
  await expect(
    admin.getByText("$50.00 was refunded to the card it was paid with."),
  ).toBeVisible({ timeout: 15_000 });
  await pages.check(admin);

  // The guest's stay shows the same.
  await page.reload();
  await expect(
    page.getByText("$50.00 was refunded to the card it was paid with."),
  ).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await pages.check();
});
