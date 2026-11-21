import type { Page } from "@playwright/test";
import { expect, type Pages } from "./fixtures";

/** A minute, the step of the deployment's search prices. */
const MINUTE_MS = 60_000;

/**
 * The whole prices the deployment's searches pick from, a band for each scenario that
 * searches the catalogue there: the catalogue's own, whose listings run a cent apart from
 * its search price up, and the host's listing's above it.
 */
export const LIVE_PRICE_BANDS = {
  catalogue: { first: 3_000, count: 500_000 },
  hostListing: { first: 503_000, count: 497_000 },
} as const;

/**
 * A search price on the deployment, in a scenario's band: the minute the attempt started,
 * counted round the band. There the cached catalogue pages outlive the run, so a price an
 * earlier run searched would first be answered by that run's page, and visitors list stays
 * of their own, at the round prices a visitor asks for a night. A price far above those and
 * new for every run while the band lasts — nearly a year for either — is searched by
 * nobody else.
 */
export function livePrice(band: keyof typeof LIVE_PRICE_BANDS): number {
  const { first, count } = LIVE_PRICE_BANDS[band];

  return first + (Math.floor(Date.now() / MINUTE_MS) % count);
}

/**
 * The catalogue's search shows the listing under this title — or, given `null`, nothing.
 * The catalogue is a cached read its writes mark stale, so the page served right after a
 * change may still be the one before it, with the fresh one behind it: the visitor reloads
 * until it arrives.
 */
export async function expectInCatalogue(
  page: Page,
  pages: Pages,
  search: string,
  title: string | null,
): Promise<void> {
  const stays = page.getByRole("main").getByRole("listitem");
  let opened = false;

  await expect(async () => {
    // Opened the first time, reloaded after: the page answers the search the visitor typed.
    if (opened) {
      await page.reload();
    } else {
      await page.goto(search);
      opened = true;
    }

    if (title === null) {
      await expect(page.getByText("Nothing matches this search")).toBeVisible({
        timeout: 1_000,
      });
      await expect(stays).toHaveCount(0, { timeout: 1_000 });
    } else {
      await expect(stays).toHaveCount(1, { timeout: 1_000 });
      await expect(stays.getByRole("link", { name: title })).toBeVisible({
        timeout: 1_000,
      });
    }
  }).toPass({ timeout: 10_000 });
  await pages.check(page);
}
