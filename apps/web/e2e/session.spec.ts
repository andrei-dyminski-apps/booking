import { GUEST } from "./demo";
import { expect, test } from "./fixtures";
import { EVERY_TARGET } from "./target";
import { signInThroughForm } from "./session";

test(
  "a demo account signs in, finds its details and signs out",
  { tag: EVERY_TARGET },
  async ({ page, pages }) => {
    const guest = GUEST;

    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await pages.check();

    await signInThroughForm(page, guest);

    await expect(page).toHaveURL("/profile");

    // The shell's link to the account, named after it.
    const account = page.getByRole("link", { name: new RegExp(guest.name) });

    await expect(account).toBeVisible();

    const details = page.getByRole("main");

    await expect(details.getByText(guest.name, { exact: true })).toBeVisible();
    await expect(details.getByText(guest.email, { exact: true })).toBeVisible();

    // The day the account was opened, on the reader's clock rather than the server's.
    await expect(
      details.getByText(guest.joined, { exact: true }),
    ).toBeVisible();
    await pages.check();

    await details.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL("/");
    await expect(account).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Sign in" }).first(),
    ).toBeVisible();
    await pages.check();

    await page.goto("/profile");

    await expect(page).toHaveURL("/login?next=%2Fprofile");
  },
);

test(
  "a page behind the session sends a stranger to sign in and then on to it",
  { tag: EVERY_TARGET },
  async ({ page, pages }) => {
    await page.goto("/bookings");

    await expect(page).toHaveURL("/login?next=%2Fbookings");
    await pages.check();

    await signInThroughForm(page, GUEST);

    await expect(page).toHaveURL("/bookings");
    await expect(
      page.getByRole("heading", { level: 1, name: "Your trips" }),
    ).toBeVisible();
    await pages.check();
  },
);
