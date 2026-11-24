import { expect, test } from "../support/fixtures";
import { fillRegistration } from "../support/session";

test("a new visitor registers and lands signed in under their own name", async ({
  page,
  pages,
}) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(URL, "parse");
  });
  // New on every attempt: an address once registered stays taken.
  const name = "Robin Ashdown";
  const email = `robin-${String(Date.now())}@e2e.example.net`;

  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /Rooms, dates and guests/ }),
  ).toBeVisible();
  await pages.check();

  await page.getByRole("link", { name: "Create an account" }).click();

  await expect(page).toHaveURL("/register");
  await expect(page).toHaveTitle(/^Create an account · /);
  await expect(
    page.getByRole("button", { name: "Send sign-up link" }),
  ).toBeVisible();
  await pages.check();

  await fillRegistration(page, pages, name, email, "a-new-password");

  await expect(page).toHaveURL("/profile");

  const details = page.getByRole("main");

  await expect(details.getByText(name, { exact: true })).toBeVisible();
  await expect(details.getByText(email, { exact: true })).toBeVisible();
  // The shell's link to the account, named after it.
  await expect(
    page.getByRole("link", { name: new RegExp(name) }),
  ).toBeVisible();
  await pages.check();

  const notifications = page.getByRole("button", {
    name: "Email notifications",
  });
  const settings = page.getByRole("dialog", { name: "Email notifications" });
  const messages = settings.getByRole("checkbox", {
    name: "Unread conversations",
  });
  await notifications.click();
  await expect(
    settings.getByText("Email confirmed", { exact: true }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Resend confirmation" }),
  ).toHaveCount(0);
  await pages.check();
  await messages.uncheck();
  await settings
    .getByRole("button", { name: "Save email preferences" })
    .click();
  await expect(settings.getByRole("status")).toHaveText(
    "Email preferences saved.",
  );
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(notifications).toBeFocused();
  await page.reload();
  await notifications.click();
  await expect(messages).not.toBeChecked();
  await pages.check();
});
