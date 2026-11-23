import { expect, test } from "./fixtures";
import { mailLink, readMail } from "./inbox";
import { fillRegistration } from "./session";

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
  await expect(
    details.getByText("Email confirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    details.getByRole("button", { name: "Resend confirmation" }),
  ).toHaveCount(0);
  // The shell's link to the account, named after it.
  await expect(
    page.getByRole("link", { name: new RegExp(name) }),
  ).toBeVisible();
  await pages.check();
});

test("a member changes their email and resets their password through the inbox", async ({
  page,
  pages,
}) => {
  const stamp = String(Date.now());
  const email = `account-${stamp}@e2e.example.net`;
  const newEmail = `New-${stamp}@e2e.example.net`;
  const password = "a-new-password";

  await page.goto("/register");
  await pages.check();
  await fillRegistration(page, pages, "Robin Ashdown", email, password);
  await expect(page).toHaveURL("/profile");

  await pages.check();

  await page.getByLabel("New email").fill(newEmail);
  await page.getByLabel("Current password").fill(password);
  await page.getByRole("button", { name: "Send confirmation link" }).click();
  await expect(page.getByText(/Your current email stays active/)).toBeVisible();
  const changeLink = await mailLink(
    newEmail,
    "Confirm your new StayDesk email address",
    "/confirm-email",
  );
  await page.goto(changeLink.href);
  await pages.check();
  await page.getByRole("button", { name: "Confirm email" }).click();
  await page.getByRole("link", { name: "Sign in with your new email" }).click();
  await expect(page).toHaveURL("/login");
  await pages.check();
  await readMail(email, "Your StayDesk email address changed");

  await page.getByRole("link", { name: "Forgot password?" }).click();
  await pages.check();
  await page.getByLabel("Email", { exact: true }).fill(newEmail);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/you’ll receive a link shortly/)).toBeVisible();
  const resetLink = await mailLink(
    newEmail,
    "Reset your StayDesk password",
    "/reset-password",
  );
  await page.goto(resetLink.href);
  await pages.check();
  await page
    .getByLabel("New password", { exact: true })
    .fill("a-replacement-password");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText(/Password updated/)).toBeVisible();
  await pages.check();
});
