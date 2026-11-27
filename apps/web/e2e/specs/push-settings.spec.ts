import { expect, test } from "../support/fixtures";
import { registerThroughForm } from "../support/session";

test("a member sets how push notifications reach them, and finds it kept", async ({
  page,
  pages,
}) => {
  // An account of the test's own: the preferences are the account's.
  await registerThroughForm(page, pages, "Ines Moreau");

  await page.getByRole("button", { name: "Push notifications" }).click();

  const dialog = page.getByRole("dialog", { name: "Push notifications" });

  await expect(dialog).toBeVisible();
  await pages.check();

  await dialog.getByRole("checkbox", { name: "Reviews" }).uncheck();
  await dialog
    .getByRole("checkbox", { name: "Hold notifications overnight" })
    .check();
  await dialog.getByLabel("From").fill("23:00");
  await dialog.getByLabel("Until").fill("06:30");
  // An edited window takes the zone of the browser that edits it.
  await expect(
    dialog.getByText("Changes will use Pacific/Auckland"),
  ).toBeVisible();
  await dialog.getByRole("combobox", { name: "At most" }).click();
  await page.getByRole("option", { name: "3 an hour" }).click();
  await dialog
    .getByRole("button", { name: "Save notification preferences" })
    .click();

  await expect(
    dialog.getByText("Notification preferences saved."),
  ).toBeVisible();
  await pages.check();

  // Read back from the API, not from the dialog's own state.
  await page.reload();
  await page.getByRole("button", { name: "Push notifications" }).click();

  await expect(
    dialog.getByRole("checkbox", { name: "Reviews" }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "Bookings and cancellations" }),
  ).toBeChecked();
  await expect(dialog.getByLabel("From")).toHaveValue("23:00");
  await expect(dialog.getByLabel("Until")).toHaveValue("06:30");
  await expect(dialog.getByText("Times are in Pacific/Auckland")).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "At most" })).toHaveText(
    /3 an hour/,
  );
  // A member is not offered what only an admin is told.
  await expect(
    dialog.getByRole("checkbox", { name: "Admin alerts" }),
  ).toHaveCount(0);
  await pages.check();
});
