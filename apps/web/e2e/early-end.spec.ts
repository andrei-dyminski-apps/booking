import { DEMO } from "./demo";
import { expect, test } from "./fixtures";
import { signInThroughForm } from "./session";
import { dayIn, holdAndPay, zoneWellInsideItsDay } from "./stay";

test("a guest ends a stay that has begun and is refunded the nights left", async ({
  page,
  pages,
  arrange,
}) => {
  // A stay that has begun: check-in at midnight where the listing is, on its today, which
  // has come already. Paid through the pages like any other.
  const timeZone = zoneWellInsideItsDay();
  const listing = await arrange.listing({
    pricePerNightCents: 10_000,
    timeZone,
    checkInTime: "00:00",
  });

  await page.goto(`/login?next=/listings/${listing.id}`);
  await pages.check();
  await signInThroughForm(page, DEMO.guest);

  await expect(
    page.getByRole("heading", { level: 1, name: listing.title }),
  ).toBeVisible();
  await pages.check();

  await holdAndPay(page, pages, {
    from: dayIn(timeZone),
    to: dayIn(timeZone, 3),
    total: "$300.00",
  });

  // Tonight is used; the two nights after it go back, and a flexible stay refunds them whole.
  await page.getByRole("button", { name: "End stay early" }).click();

  const dialog = page.getByRole("alertdialog");

  await expect(dialog).toContainText(
    "the 2 nights after tonight go back on offer",
  );
  await expect(dialog).toContainText("$200.00 back to the card");
  await pages.check();

  await dialog.getByRole("button", { name: "End the stay" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^Ended early on /)).toBeVisible();
  await expect(
    page.getByText(
      /A refund of \$200\.00 is on its way|\$200\.00 was refunded to the card/,
    ),
  ).toBeVisible();
  await pages.check();

  // The refund goes out to the provider after the answer, and the page records it once
  // the provider has taken it.
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByText("$200.00 was refunded to the card it was paid with."),
    ).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await pages.check();
});
