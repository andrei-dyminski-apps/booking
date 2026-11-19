import { tz } from "@date-fns/tz";
import { addDays, format, getHours } from "date-fns";
import type { Page } from "@playwright/test";
import { expect, type Pages } from "./fixtures";

/** A day `offset` days from today on the clock of `timeZone`, as the contract writes days. */
export function dayIn(timeZone: string, offset = 0): string {
  const zone = { in: tz(timeZone) };

  return format(addDays(Date.now(), offset, zone), "yyyy-MM-dd", zone);
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
  await page.getByLabel("Check in", { exact: true }).fill(stay.from);
  await page.getByLabel("Check out", { exact: true }).fill(stay.to);

  await expect(page.getByText(`= ${stay.total}`)).toBeVisible();

  await page.getByRole("button", { name: "Hold these dates" }).click();

  // The hold, with the time it lapses at and the minutes left, and the payment form under it.
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
  await expect(page.getByText("The nights are held until")).toBeVisible();
  await expect(page.getByText(/^\(\d+ minutes? left\)$/)).toBeVisible();

  const pay = page.getByRole("button", { name: `Pay ${stay.total}` });

  await expect(pay).toBeVisible();
  await pages.check();

  await pay.click();

  // Confirmed by the provider's news, not by the browser's word: the page waits for it. Two
  // webhooks through the API's queue, then the page's next poll, every two seconds — longer
  // than `expect`'s default leaves room for on a slow runner.
  await expect(page.getByText("Paid and confirmed.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await pages.check();
}
