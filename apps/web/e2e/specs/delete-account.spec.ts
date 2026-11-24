import { expect, test } from "../support/fixtures";
import { registerThroughForm, signInThroughForm } from "../support/session";

test("a member with nothing open deletes their account from the profile and can no longer sign in", async ({
  page,
  pages,
}) => {
  // An account of the test's own, with no stay, payout or fee open on it: deleting it is
  // the whole point.
  const member = await registerThroughForm(page, pages, "Noor Haddad");

  await page.getByRole("button", { name: "Delete account" }).click();

  const confirm = page.getByRole("alertdialog", {
    name: "Delete your account?",
  });

  await expect(confirm).toBeVisible();
  await pages.check();

  await confirm
    .getByLabel("Password", { exact: true })
    .fill(member.password ?? "");
  await confirm.getByRole("button", { name: "Delete my account" }).click();

  // Signed out, on the home page, told it worked.
  await expect(page).toHaveURL("/?account=deleted");
  await expect(page.getByText("Your account has been deleted")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in" }).first(),
  ).toBeVisible();
  await pages.check();

  // The address and the password open nothing any more.
  await page.goto("/login");
  await pages.check();
  await signInThroughForm(page, member);

  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await expect(page).toHaveURL("/login");
  await pages.check();
});
