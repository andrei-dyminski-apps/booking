import { DEMO } from "./demo";
import { expect, test } from "./fixtures";
import { EVERY_TARGET, providerWait } from "./target";
import { signInToListing } from "./session";
import { begunStayListing, dayIn, holdAndPay } from "./stay";

test(
  "a guest ends a stay that has begun and is refunded the nights left",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange }) => {
    // A stay that has begun: check-in at midnight where the listing is, on its today, which
    // has come already. Paid through the pages like any other.
    const listing = await arrange.listing({
      pricePerNightCents: 10_000,
      ...begunStayListing(),
    });

    await signInToListing(page, pages, DEMO.guest, listing);
    await holdAndPay(page, pages, {
      from: dayIn(listing.timeZone),
      to: dayIn(listing.timeZone, 3),
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
    }).toPass({ timeout: providerWait(10_000) });
    await pages.check();
  },
);
