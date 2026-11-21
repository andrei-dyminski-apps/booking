import { GUEST } from "./demo";
import { expect, test } from "./fixtures";
import { EVERY_TARGET } from "./target";
import { signInToListing } from "./session";
import { sidebarLink } from "./shell";
import { dayIn, dayLabel, holdAndPay } from "./stay";

test(
  "a guest who has booked finds the stay among their bookings and opens it",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange }) => {
    const listing = await arrange.listing({ pricePerNightCents: 9_000 });
    const from = dayIn(listing.timeZone, 20);
    const to = dayIn(listing.timeZone, 23);

    // The stay, paid through the pages like every other.
    await signInToListing(page, pages, GUEST, listing);
    await holdAndPay(page, pages, { from, to, total: "$270.00" });

    await page.goto("/");
    await pages.check();
    await sidebarLink(page, "Bookings").click();

    await expect(page).toHaveURL("/bookings");
    await expect(
      page.getByRole("heading", { level: 1, name: "Your trips" }),
    ).toBeVisible();

    // Newest first, so the stay just paid for is on the first page, with its dates, its
    // amount and where it stands.
    const stay = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: listing.title }) });

    await expect(stay).toHaveCount(1);
    await expect(stay).toContainText(`${dayLabel(from)} → ${dayLabel(to)}`);
    await expect(stay).toContainText("3 nights");
    await expect(stay).toContainText("$270.00");
    await expect(stay.getByText("Confirmed", { exact: true })).toBeVisible();
    await pages.check();

    await stay.getByRole("link", { name: "Details" }).click();

    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { level: 1, name: listing.title }),
    ).toBeVisible();
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    await pages.check();
  },
);
