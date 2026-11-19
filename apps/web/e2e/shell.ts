import type { Locator, Page } from "@playwright/test";

/**
 * A section of the navigation, by its label, in the sidebar the shell draws on a wide
 * screen. Each link is named by its label and the hint under it ("Bookings Stays and
 * holds"), so the label is matched as the name's first word or words.
 */
export function sidebarLink(page: Page, label: string): Locator {
  return page
    .getByRole("complementary")
    .getByRole("link", { name: new RegExp(`^${label}( |$)`) });
}
