import { DEMO } from "./demo";
import { expect, test } from "./fixtures";
import { signInThroughForm, signInToListing } from "./session";
import { dayIn, holdAndPay } from "./stay";

test("a host cancels a guest's paid stay and the guest sees the refund the dialog stated", async ({
  page,
  pages,
  arrange,
  another,
}) => {
  const listing = await arrange.listing({ pricePerNightCents: 8_000 });

  await signInToListing(page, pages, DEMO.guest, listing);
  await holdAndPay(page, pages, {
    from: dayIn(listing.timeZone, 25),
    to: dayIn(listing.timeZone, 27),
    total: "$160.00",
  });

  const stayPage = page.url();
  const hostPage = await another();

  await hostPage.goto(
    `/login?next=${encodeURIComponent("/bookings?side=HOST")}`,
  );
  await pages.check(hostPage);
  await signInThroughForm(hostPage, await arrange.host());

  const stay = hostPage
    .getByRole("listitem")
    .filter({ has: hostPage.getByRole("link", { name: listing.title }) });

  await expect(stay.getByText("Confirmed", { exact: true })).toBeVisible();
  await pages.check(hostPage);

  await stay.getByRole("button", { name: "Cancel as host" }).click();

  // A host refunds the guest in full under any policy, and pays a fee for it — 25% this far
  // from the check-in.
  const dialog = hostPage.getByRole("alertdialog", {
    name: "Cancel this stay?",
  });

  await expect(dialog).toContainText(
    "the guest is refunded in full and you pay a fee of $40.00 (25% of what it refunds)",
  );
  await dialog
    .getByLabel("Why are you cancelling?", { exact: true })
    .fill("A burst pipe in the kitchen.");
  await pages.check(hostPage);
  await dialog.getByRole("button", { name: "Cancel the stay" }).click();

  await expect(dialog).toBeHidden();
  await expect(stay.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(stay).toContainText("by the host");
  await pages.check(hostPage);

  // The guest's stay: cancelled by the host, for the reason given, and the whole of it back.
  await page.goto(stayPage);
  await expect(
    page.getByText(
      /^Cancelled by the host on .+: “A burst pipe in the kitchen\.”$/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText("$160.00 was refunded to the card it was paid with."),
  ).toBeVisible({ timeout: 15_000 });
  await pages.check();
});
