import { DEMO } from "../support/demo";
import { expect, test } from "../support/fixtures";
import { registerThroughForm, signInThroughForm } from "../support/session";
import { sidebarLink } from "../support/shell";

test("the admin finds a user through the filtered list, blocks them, and they can no longer sign in", async ({
  page,
  pages,
  another,
}) => {
  // An account of the test's own: blocking changes it.
  const user = await registerThroughForm(
    await another(),
    pages,
    "Lou Marchetti",
  );

  await page.goto("/login");
  await pages.check();
  await signInThroughForm(page, DEMO.admin);
  await expect(page).toHaveURL("/profile");
  await pages.check();

  await sidebarLink(page, "Users").click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Users" }),
  ).toBeVisible();
  await pages.check();

  await page.getByRole("button", { name: "Filters" }).click();

  const dialog = page.getByRole("dialog", { name: "Filter the users" });

  await dialog.getByRole("textbox", { name: "Email" }).fill(user.email);
  await pages.check();
  await dialog.getByRole("button", { name: "Show users" }).click();

  await expect(dialog).toBeHidden();

  const found = page.getByRole("main").getByRole("listitem");

  await expect(found).toHaveCount(1);
  await expect(found).toContainText(user.name);
  await pages.check();

  await found.getByRole("link", { name: "Manage" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: user.name }),
  ).toBeVisible();
  await pages.check();

  await page.getByRole("button", { name: "Block", exact: true }).click();

  const confirm = page.getByRole("alertdialog", {
    name: `Block ${user.name}?`,
  });

  await expect(confirm).toBeVisible();
  await pages.check();
  await confirm.getByRole("button", { name: "Block the account" }).click();

  await expect(confirm).toBeHidden();
  await expect(page.getByText("Blocked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unblock" })).toBeVisible();
  await pages.check();

  // The user, in a browser of their own, is refused at the sign-in form.
  const refused = await another();

  await refused.goto("/login");
  await pages.check(refused);
  await signInThroughForm(refused, user);

  await expect(
    refused.getByText("This account has been blocked"),
  ).toBeVisible();
  await expect(refused).toHaveURL("/login");
  await pages.check(refused);
});
