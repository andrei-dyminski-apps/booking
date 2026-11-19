import type { Page } from "@playwright/test";
import { expect, type Pages } from "./fixtures";

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
