import { DEMO } from "../support/demo";
import { expect, test } from "../support/fixtures";
import { registerThroughForm, signInToListing } from "../support/session";
import { dayIn, dayLabel, pickDates } from "../support/stay";

test("a guest joins the waitlist for nights somebody else holds, finds it on their waitlist and leaves it", async ({
  page,
  pages,
  arrange,
  another,
}) => {
  const listing = await arrange.listing({ pricePerNightCents: 9_500 });
  const from = dayIn(listing.timeZone, 50);
  const to = dayIn(listing.timeZone, 52);

  // Somebody else — a guest the test registers — holds the nights first.
  const holder = await another();

  await registerThroughForm(holder, pages, "Kit Halvorsen");
  await holder.goto(`/listings/${listing.id}`);
  await pages.check(holder);
  await pickDates(holder, { from, to, total: "$190.00" });
  await holder.getByRole("button", { name: "Hold these dates" }).click();
  await expect(holder).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
  await expect(holder.getByText("The nights are held until")).toBeVisible();
  await expect(
    holder.getByRole("button", { name: "Pay $190.00" }),
  ).toBeVisible();
  await pages.check(holder);

  // The calendar is a cached read the hold marked stale: the guest reloads until it shows
  // the nights taken.
  await signInToListing(page, pages, DEMO.guest, listing);
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByText(`${dayLabel(from)}: booked`, { exact: true }),
    ).toBeAttached({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });

  // Taken nights are waited for rather than held.
  await pickDates(page, { from, to, total: "$190.00" });
  await pages.check();
  await page.getByRole("button", { name: "Notify me when free" }).click();

  await expect(page).toHaveURL("/waitlist");
  await expect(
    page.getByRole("heading", { level: 1, name: "Your waitlist" }),
  ).toBeVisible();

  const entry = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: listing.title }) });

  await expect(entry).toContainText(`${dayLabel(from)} → ${dayLabel(to)}`);
  await expect(entry).toContainText("2 nights");
  await pages.check();

  await entry.getByRole("button", { name: "Leave" }).click();

  await expect(entry).toHaveCount(0);
  await pages.check();
});
