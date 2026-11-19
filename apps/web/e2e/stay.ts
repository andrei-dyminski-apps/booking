import { tz } from "@date-fns/tz";
import { addDays, format, getHours, parseISO } from "date-fns";
import type { Page } from "@playwright/test";
import { expect, type Pages } from "./fixtures";

/** A day `offset` days from today on the clock of `timeZone`, as the contract writes days. */
export function dayIn(timeZone: string, offset = 0): string {
  const zone = { in: tz(timeZone) };

  return format(addDays(Date.now(), offset, zone), "yyyy-MM-dd", zone);
}

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** A contract day as the pages write it: `16 Jan 2026`. */
export function dayLabel(day: string): string {
  return DAY_LABEL.format(parseISO(day, { in: tz("UTC") }));
}

/**
 * Zones spread around the world, for a listing whose check-in day has begun: one of them is
 * always well inside its day, so the day a test books from does not turn while it runs.
 */
const ZONES_AROUND_THE_WORLD = [
  "Pacific/Auckland",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Europe/Lisbon",
  "America/New_York",
  "Pacific/Honolulu",
];

/** A zone whose clock reads between 02:00 and 21:59 now. */
export function zoneWellInsideItsDay(): string {
  const zone = ZONES_AROUND_THE_WORLD.find((candidate) => {
    const hour = getHours(Date.now(), { in: tz(candidate) });

    return hour >= 2 && hour < 22;
  });

  if (zone === undefined) throw new Error("No zone is inside its day");

  return zone;
}

/** On the listing's page: picks the dates in the booking form, and sees what they cost. */
export async function pickDates(
  page: Page,
  stay: { from: string; to: string; total: string },
): Promise<void> {
  await page.getByLabel("Check in", { exact: true }).fill(stay.from);
  await page.getByLabel("Check out", { exact: true }).fill(stay.to);

  await expect(page.getByText(`= ${stay.total}`)).toBeVisible();
}

/**
 * On the listing's page: picks the dates, holds the stay and pays for it through the payment
 * form, landing on the confirmed stay. The money goes through the pages, as on every target;
 * on the hermetic stack the card is the stand-in's.
 */
export async function holdAndPay(
  page: Page,
  pages: Pages,
  stay: { from: string; to: string; total: string },
): Promise<void> {
  await pickDates(page, stay);
  await holdAndPayPicked(page, pages, stay.total);
}

/** The second half of `holdAndPay`, for a scenario with something to do between the two. */
export async function holdAndPayPicked(
  page: Page,
  pages: Pages,
  total: string,
): Promise<void> {
  await page.getByRole("button", { name: "Hold these dates" }).click();

  // The hold, with the time it lapses at and the minutes left, and the payment form under it.
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
  await expect(page.getByText("The nights are held until")).toBeVisible();
  await expect(page.getByText(/^\(\d+ minutes? left\)$/)).toBeVisible();

  const pay = page.getByRole("button", { name: `Pay ${total}` });

  await expect(pay).toBeVisible();
  await pages.check(page);

  await pay.click();

  // Confirmed by the provider's news, not by the browser's word: the page waits for it. Two
  // webhooks through the API's queue, then the page's next poll, every two seconds — longer
  // than `expect`'s default leaves room for on a slow runner.
  await expect(page.getByText("Paid and confirmed.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await pages.check(page);
}

/**
 * What a listing needs for a stay booked on it from today to have begun already: check-in
 * at midnight where it is, in a zone well inside its day, so tonight is under way there.
 */
export function begunStayListing(): { timeZone: string; checkInTime: string } {
  return { timeZone: zoneWellInsideItsDay(), checkInTime: "00:00" };
}

/**
 * On the page of a stay that has begun: ends it early, which is the one way a stay is over
 * before its last night — and what opens the reviews on both sides.
 */
export async function endStayEarly(page: Page, pages: Pages): Promise<void> {
  await page.getByRole("button", { name: "End stay early" }).click();

  const dialog = page.getByRole("alertdialog");

  await expect(dialog).toBeVisible();
  await pages.check(page);
  await dialog.getByRole("button", { name: "End the stay" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^Ended early on /)).toBeVisible();
  await pages.check(page);
}

/** In the review dialog that is open: the stars, the words, and publishing them. */
export async function writeReview(
  page: Page,
  pages: Pages,
  dialogTitle: string,
  review: { stars: number; comment: string },
): Promise<void> {
  const dialog = page.getByRole("dialog", { name: dialogTitle });

  // The stars are drawn over the radios they stand for; picked from the keyboard, the way
  // the radio itself is reached.
  const stars = dialog.getByRole("radio", {
    name: `${String(review.stars)} out of 5 stars`,
  });

  await stars.focus();
  await page.keyboard.press("Space");
  await expect(stars).toBeChecked();
  await dialog.getByLabel("Review", { exact: true }).fill(review.comment);
  await pages.check(page);
  await dialog.getByRole("button", { name: "Publish the review" }).click();

  await expect(dialog).toBeHidden();
}
