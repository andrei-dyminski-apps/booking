import { DEMO } from "./demo";
import { expect, test } from "./fixtures";
import { EVERY_TARGET } from "./target";
import { signInToListing } from "./session";
import { dayIn, holdAndPayPicked, pickDates } from "./stay";

test(
  "a guest picks the non-refundable rate and the stay keeps it and its terms",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange }) => {
    const listing = await arrange.listing({
      pricePerNightCents: 10_000,
      cancellationPolicy: "FLEXIBLE",
      nonRefundableDiscountBps: 1_000,
    });

    await signInToListing(page, pages, DEMO.guest, listing);

    await pickDates(page, {
      from: dayIn(listing.timeZone, 30),
      to: dayIn(listing.timeZone, 33),
      total: "$300.00",
    });

    // Both rates side by side, each with what it costs and what cancelling it gives back.
    const rates = page.getByRole("radiogroup", { name: "Rate" });
    const standard = rates.getByRole("radio", {
      name: /^Standard — \$300\.00/,
    });
    const nonRefundable = rates.getByRole("radio", {
      name: /^Non-refundable, 10% off — \$270\.00/,
    });

    await expect(standard).toBeChecked();
    await expect(nonRefundable).toBeVisible();
    await expect(
      page.getByText("Cancelling refunds nothing. If the host cancels"),
    ).toBeVisible();

    const ifCancelled = page.getByRole("group", {
      name: "If you cancel this stay",
    });

    await expect(ifCancelled).toContainText("Full refund");
    await pages.check();

    await nonRefundable.click();

    await expect(nonRefundable).toBeChecked();
    await expect(page.getByText("= $270.00")).toBeVisible();
    await expect(ifCancelled).toContainText("At any time: No refund");
    await expect(ifCancelled).not.toContainText("Full refund");
    await pages.check();

    await holdAndPayPicked(page, pages, "$270.00");

    // The stay kept the rate: its discount, and the terms it was booked under.
    await expect(
      page.getByText("− $30.00 non-refundable discount"),
    ).toBeVisible();

    const terms = page.getByRole("group", {
      name: "Cancellation",
      exact: true,
    });

    await expect(terms).toContainText("Non-refundable");
    await expect(terms).toContainText("At any time: No refund");
    await pages.check();
  },
);
