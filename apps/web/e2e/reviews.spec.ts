import { GUEST } from "./demo";
import { expect, test } from "./fixtures";
import { EVERY_TARGET } from "./target";
import { signInToListing } from "./session";
import { sidebarLink } from "./shell";
import {
  begunStayListing,
  dayIn,
  endStayEarly,
  holdAndPay,
  writeReview,
} from "./stay";

test(
  "after a stay that is over, the guest reviews the listing and the review shows on it",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange }) => {
    // New on every attempt: the suite's guest on the deployment keeps every earlier run's
    // reviews.
    const comment = `Quiet, warm, and the host left bread for the morning (${Date.now().toString(36)}).`;
    const listing = await arrange.listing({
      pricePerNightCents: 10_000,
      ...begunStayListing(),
    });

    // A stay is over only once it has ended: one that has begun, ended early.
    await signInToListing(page, pages, GUEST, listing);
    await holdAndPay(page, pages, {
      from: dayIn(listing.timeZone),
      to: dayIn(listing.timeZone, 3),
      total: "$300.00",
    });
    await endStayEarly(page, pages);

    await sidebarLink(page, "Bookings").click();

    const stay = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: listing.title }) });

    await expect(stay.getByText("Ended early", { exact: true })).toBeVisible();
    await pages.check();

    await stay.getByRole("button", { name: "Review the stay" }).click();
    await writeReview(page, pages, "How was the stay?", { stars: 5, comment });

    // Among the guest's stays it is marked reviewed, and it is offered no second time.
    await expect(stay.getByText("Reviewed", { exact: true })).toBeVisible();
    await expect(
      stay.getByRole("button", { name: "Review the stay" }),
    ).toHaveCount(0);
    await pages.check();

    // On the listing, for everybody who reads it.
    await stay.getByRole("link", { name: listing.title }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: listing.title }),
    ).toBeVisible();

    const review = page.getByRole("listitem").filter({ hasText: comment });

    await expect(review).toBeVisible();
    await expect(review.getByLabel("5 out of 5 stars")).toBeVisible();
    await pages.check();
  },
);
