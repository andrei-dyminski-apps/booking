import { expect, test } from "../support/fixtures";
import { mailLink, readMail } from "../support/inbox";
import { fillRegistration, signInThroughForm } from "../support/session";

test("a member changes their email and resets their password through the inbox", async ({
  page,
  pages,
}) => {
  const stamp = String(Date.now());
  const name = "Robin Ashdown";
  const email = `account-${stamp}@e2e.example.net`;
  const newEmail = `New-${stamp}@e2e.example.net`;
  const password = "a-new-password";
  const newPassword = "a-replacement-password";

  await page.goto("/register");
  await pages.check();
  await fillRegistration(page, pages, name, email, password);
  await expect(page).toHaveURL("/profile");

  await pages.check();

  const changePassword = page.getByRole("button", { name: "Change password" });
  await changePassword.click();
  const passwordDialog = page.getByRole("dialog", { name: "Change password" });
  await expect(passwordDialog).toBeVisible();
  await pages.check();
  await passwordDialog.getByRole("button", { name: "Send reset link" }).click();
  await expect(passwordDialog.getByRole("status")).toContainText(
    "Reset link requested.",
  );
  await mailLink(email, "Reset your StayDesk password", "/reset-password");
  await page.keyboard.press("Escape");
  await expect(changePassword).toBeFocused();

  await page.getByRole("button", { name: "Change email", exact: true }).click();
  const emailDialog = page.getByRole("dialog", { name: "Change email" });
  await emailDialog.getByLabel("New email").fill(newEmail);
  await emailDialog.getByLabel("Current password").fill(password);
  await pages.check();
  await emailDialog
    .getByRole("button", { name: "Send confirmation link" })
    .click();
  await expect(emailDialog.getByRole("status")).toContainText(
    "Your current email stays active",
  );
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
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText(/Password updated/)).toBeVisible();
  await pages.check();

  await signInThroughForm(page, {
    name,
    email: newEmail,
    password: newPassword,
  });

  await expect(page).toHaveURL("/profile");
  const details = page.getByRole("main");
  await expect(details.getByText(name, { exact: true })).toBeVisible();
  await expect(details.getByText(newEmail, { exact: true })).toBeVisible();
  await pages.check();
});
