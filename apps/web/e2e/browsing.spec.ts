import { GUEST } from "./demo";
import { expect, test } from "./fixtures";
import { EVERY_TARGET } from "./target";
import { signInThroughForm } from "./session";
import { dayIn, dayLabel } from "./stay";

test(
  "a stranger reads a listing, is offered to sign in to book, and comes back to it",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange }) => {
    const listing = await arrange.listing({ pricePerNightCents: 8_800 });
    const tomorrow = dayIn(listing.timeZone, 1);

    await page.goto(`/listings/${listing.id}`);

    // What it is, what a night costs, and which nights are free — all without an account.
    await expect(
      page.getByRole("heading", { level: 1, name: listing.title }),
    ).toBeVisible();
    await expect(page.getByText("$88.00 a night")).toBeVisible();
    await expect(
      page.getByText("A quiet room the browser suite arranged"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Availability" }),
    ).toBeVisible();
    await expect(
      page.getByText(`${dayLabel(tomorrow)}: free`, { exact: true }),
    ).toBeAttached();

    // Booking and writing to the host both wait for an account.
    await expect(
      page.getByRole("link", { name: "Sign in to ask" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Hold these dates" }),
    ).toHaveCount(0);
    await pages.check();

    await page.getByRole("link", { name: "Sign in to book" }).click();

    await expect(page).toHaveURL(
      `/login?next=${encodeURIComponent(`/listings/${listing.id}`)}`,
    );
    await pages.check();

    await signInThroughForm(page, GUEST);

    // Back on the listing, now with the form to book it and the box to ask its host.
    await expect(page).toHaveURL(`/listings/${listing.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: listing.title }),
    ).toBeVisible();
    await expect(page.getByLabel("Check in", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Hold these dates" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sign in to ask" }),
    ).toHaveCount(0);
    await pages.check();
  },
);
