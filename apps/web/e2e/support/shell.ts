import type { Locator, Page } from "@playwright/test";
import { expect, type Pages } from "./fixtures";

/**
 * The width from which the shell keeps its sidebar open — Tailwind's `lg`, which
 * `header.tsx` hides the menu button at. Below it the navigation is in the sheet.
 */
const SIDEBAR_FROM = 1024;

/**
 * A section of the navigation, by its label, in the sidebar the shell draws on a wide
 * screen. Each link is named by its label and the hint under it ("Bookings Stays and
 * holds"), so the label is matched as the name's first word or words.
 */
export function sidebarLink(page: Page, label: string): Locator {
  return linkIn(page.getByRole("complementary"), label);
}

/**
 * Opens a section from the navigation the way this page's screen offers it: the sidebar on
 * a wide one, the sheet behind the header's menu button on a narrow one, which closes
 * behind the link it opened.
 */
export async function openFromMenu(page: Page, label: string): Promise<void> {
  if (!narrow(page)) {
    await sidebarLink(page, label).click();

    return;
  }

  const sheet = await openMenu(page);

  await linkIn(sheet, label).click();
  await expect(sheet).toBeHidden();
}

/**
 * The navigation marks the section as the one the visitor is on. On a narrow screen that
 * is read in the sheet, opened for it and closed again.
 */
export async function expectCurrentSection(
  page: Page,
  label: string,
): Promise<void> {
  if (!narrow(page)) {
    await expect(sidebarLink(page, label)).toHaveAttribute(
      "aria-current",
      "page",
    );

    return;
  }

  await inMenu(page, async (sheet) => {
    await expect(linkIn(sheet, label)).toHaveAttribute("aria-current", "page");
  });
}

/**
 * The account panel at the foot of the navigation names the visitor: beside the page on a
 * wide screen, in the sheet on a narrow one — which is checked like a page while it is
 * open for it, since it is drawn only then.
 */
export async function expectSignedInAs(
  page: Page,
  pages: Pages,
  name: string,
): Promise<void> {
  const account = { name: new RegExp(name) };

  if (!narrow(page)) {
    await expect(page.getByRole("link", account)).toBeVisible();

    return;
  }

  await inMenu(page, async (sheet) => {
    await expect(sheet.getByRole("link", account)).toBeVisible();
    await pages.check(page);
  });
}

/**
 * The sheet of a narrow screen, opened and checked like a page, then closed: the sidebar is
 * part of every page a wide screen checks, while the sheet is drawn only once the menu is
 * opened. On a wide screen there is nothing more to check.
 */
export async function checkMenu(page: Page, pages: Pages): Promise<void> {
  if (!narrow(page)) return;

  await inMenu(page, () => pages.check(page));
}

/**
 * Signs out from the account panel at the foot of the navigation. On a narrow screen the
 * sheet it was pressed in closes behind it, as it does behind a link.
 */
export async function signOutFromMenu(page: Page): Promise<void> {
  const signOut = { name: "Sign out" };

  if (!narrow(page)) {
    await page.getByRole("complementary").getByRole("button", signOut).click();

    return;
  }

  const sheet = await openMenu(page);

  await sheet.getByRole("button", signOut).click();
  await expect(sheet).toBeHidden();
}

/** Below the shell's breakpoint there is no sidebar, a menu button instead. */
function narrow(page: Page): boolean {
  const width = page.viewportSize()?.width;

  return width !== undefined && width < SIDEBAR_FROM;
}

/** The sheet, opened for what is read in it and closed again, so the page is left as found. */
async function inMenu(
  page: Page,
  read: (sheet: Locator) => Promise<void>,
): Promise<void> {
  const sheet = await openMenu(page);

  await read(sheet);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
}

async function openMenu(page: Page): Promise<Locator> {
  // Named by its content, which a dot of unread threads adds to.
  await page.getByRole("button", { name: /^Open the menu/ }).click();

  const sheet = page.getByRole("dialog", { name: "StayDesk" });

  await expect(sheet).toBeVisible();

  return sheet;
}

function linkIn(container: Locator, label: string): Locator {
  return container.getByRole("link", { name: new RegExp(`^${label}( |$)`) });
}
