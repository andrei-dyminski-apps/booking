import { GUEST } from "../support/demo";
import { expect, test } from "../support/fixtures";
import { EVERY_TARGET, providerWait } from "../target";
import { signInToListing } from "../support/session";
import { dayIn, holdAndPay } from "../support/stay";

test(
  "a guest cancels a paid stay and sees the refund the dialog stated reach the card",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange }) => {
    // Flexible and a month away, so the whole stay comes back.
    const listing = await arrange.listing({
      pricePerNightCents: 11_000,
      cancellationPolicy: "FLEXIBLE",
    });

    await signInToListing(page, pages, GUEST, listing);
    await holdAndPay(page, pages, {
      from: dayIn(listing.timeZone, 30),
      to: dayIn(listing.timeZone, 32),
      total: "$220.00",
    });

    await page.getByRole("button", { name: "Cancel the stay" }).click();

    const dialog = page.getByRole("alertdialog", { name: "Cancel this stay?" });

    await expect(dialog).toContainText("refunds the stay in full");
    await pages.check();

    await dialog.getByRole("button", { name: "Cancel the stay" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        /A refund of \$220\.00 is on its way|\$220\.00 was refunded to the card/,
      ),
    ).toBeVisible();
    await pages.check();

    // The refund goes out after the answer; the page follows it until the provider has it.
    await expect(
      page.getByText("$220.00 was refunded to the card it was paid with."),
    ).toBeVisible({ timeout: providerWait(15_000) });
    await expect(page.getByText(/is on its way/)).toHaveCount(0);
    await pages.check();
  },
);
