import { expect, test } from "./fixtures";
import { fillRegistration } from "./session";

test("a new visitor registers and lands signed in under their own name", async ({
  page,
  pages,
}) => {
  // New on every attempt: an address once registered stays taken.
  const name = "Robin Ashdown";
  const email = `robin-${String(Date.now())}@e2e.example`;

  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /Rooms, dates and guests/ }),
  ).toBeVisible();
  await pages.check();

  await page.getByRole("link", { name: "Create an account" }).click();

  await expect(page).toHaveURL("/register");
  await expect(page).toHaveTitle(/^Create an account · /);
  await expect(
    page.getByRole("button", { name: "Create account" }),
  ).toBeVisible();
  await pages.check();

  await fillRegistration(page, name, email, "a-new-password");

  await expect(page).toHaveURL("/profile");

  const details = page.getByRole("main");

  await expect(details.getByText(name, { exact: true })).toBeVisible();
  await expect(details.getByText(email, { exact: true })).toBeVisible();
  // The shell's link to the account, named after it.
  await expect(
    page.getByRole("link", { name: new RegExp(name) }),
  ).toBeVisible();
  await pages.check();
});
