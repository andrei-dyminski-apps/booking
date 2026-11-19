import type { Page } from "@playwright/test";
import { DEMO, type Account } from "./demo";
import { expect, test, type Pages } from "./fixtures";
import { signInThroughForm } from "./session";
import { sidebarLink } from "./shell";

/** A section of the menu and the heading of the page it opens. */
type Section = { label: string; path: string; heading: string };

test("a guest reaches their pages from the menu alone", async ({
  page,
  pages,
}) => {
  await signInFromHome(page, pages, DEMO.guest);

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

  await sidebarLink(page, "Profile").click();

  await expect(page).toHaveURL("/profile");
  await expect(
    page.getByRole("main").getByText(DEMO.guest.email, { exact: true }),
  ).toBeVisible();
  await pages.check();
});

test("a host reaches their dashboard from the menu", async ({
  page,
  pages,
}) => {
  await signInFromHome(page, pages, DEMO.host);

  await walk(page, pages, [
    { label: "Dashboard", path: "/dashboard", heading: "Dashboard" },
  ]);

  // The listings the host has on offer.
  await expect(
    page.getByRole("main").getByText("Loft above the harbour"),
  ).toBeVisible();
});

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
  await sidebarLink(page, "Sign in").click();
  await expect(page).toHaveURL(/^[^?]*\/login/);
  await pages.check(page);
  await signInThroughForm(page, account);
  await expect(
    page.getByRole("link", { name: new RegExp(account.name) }),
  ).toBeVisible();
  await pages.check(page);
}

async function walk(
  page: Page,
  pages: Pages,
  sections: Section[],
): Promise<void> {
  for (const section of sections) {
    await sidebarLink(page, section.label).click();

    await expect(page).toHaveURL(section.path);
    await expect(
      page.getByRole("heading", { level: 1, name: section.heading }),
    ).toBeVisible();
    await expect(sidebarLink(page, section.label)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await pages.check(page);
  }
}
