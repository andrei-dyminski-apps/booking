import type { Page } from "@playwright/test";
import { DEMO, GUEST, type Account } from "../support/demo";
import { expect, test, type Pages } from "../support/fixtures";
import { EVERY_TARGET, TARGET } from "../target";
import { signInThroughForm } from "../support/session";
import {
  checkMenu,
  expectCurrentSection,
  expectSignedInAs,
  openFromMenu,
  signOutFromMenu,
} from "../support/shell";

/** A section of the menu and the heading of the page it opens. */
type Section = { label: string; path: string; heading: string };

test(
  "a guest reaches their pages from the menu alone and signs out from it",
  { tag: EVERY_TARGET },
  async ({ page, pages }) => {
    await signInFromHome(page, pages, GUEST);

    await walk(page, pages, [
      { label: "Bookings", path: "/bookings", heading: "Your trips" },
      { label: "Messages", path: "/messages", heading: "Messages" },
      { label: "Waitlist", path: "/waitlist", heading: "Your waitlist" },
    ]);

    // The notices are behind the bell in the header rather than in the menu.
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await page.getByRole("link", { name: "See all notifications" }).click();

    await expect(page).toHaveURL("/notifications");
    await expect(
      page.getByRole("heading", { level: 1, name: "Notifications" }),
    ).toBeVisible();
    await pages.check();

    await openFromMenu(page, "Profile");

    await expect(page).toHaveURL("/profile");
    await expect(
      page.getByRole("main").getByText(GUEST.email, { exact: true }),
    ).toBeVisible();
    await pages.check();

    // The way out is in the menu too, and leaves the visitor a stranger on the home page —
    // whose menu, checked once here rather than before every sign-in, is a stranger's.
    await signOutFromMenu(page);

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Sign up" }),
    ).toBeVisible();
    await pages.check();
    await checkMenu(page, pages);
  },
);

test(
  "a host reaches their dashboard from the menu",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange }) => {
    // The demo host with a listing of the seed's, but on the deployment, where the demo
    // host's listings are its visitors', the suite's own host with a listing of its own.
    let host: Account = DEMO.host;
    let listed = "Loft above the harbour";

    if (TARGET === "live") {
      listed = (await arrange.listing()).title;
      host = await arrange.host();
    }

    await signInFromHome(page, pages, host);

    await walk(page, pages, [
      { label: "Dashboard", path: "/dashboard", heading: "Dashboard" },
    ]);

    // The listings the host has on offer.
    await expect(page.getByRole("main").getByText(listed)).toBeVisible();
  },
);

test("the admin reaches the listings, users and payments from the menu", async ({
  page,
  pages,
}) => {
  await signInFromHome(page, pages, DEMO.admin);

  await walk(page, pages, [
    { label: "Listings", path: "/admin", heading: "Listings" },
    { label: "Users", path: "/admin/users", heading: "Users" },
    { label: "Payments", path: "/admin/payments", heading: "Payments" },
  ]);
});

/** Signs in from the home page's own link, never by typing a page's address. */
async function signInFromHome(
  page: Page,
  pages: Pages,
  account: Account,
): Promise<void> {
  await page.goto("/");
  await pages.check(page);
  await openFromMenu(page, "Sign in");
  await expect(page).toHaveURL(/^[^?]*\/login/);
  await pages.check(page);
  await signInThroughForm(page, account);
  await expectSignedInAs(page, pages, account.name);
  await pages.check(page);
}

async function walk(
  page: Page,
  pages: Pages,
  sections: Section[],
): Promise<void> {
  for (const section of sections) {
    await openFromMenu(page, section.label);

    await expect(page).toHaveURL(section.path);
    await expect(
      page.getByRole("heading", { level: 1, name: section.heading }),
    ).toBeVisible();
    await expectCurrentSection(page, section.label);
    await pages.check(page);
  }
}
