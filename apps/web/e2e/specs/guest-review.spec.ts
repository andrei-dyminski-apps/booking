import { expect, test } from "../support/fixtures";
import { EVERY_TARGET } from "../target";
import { openListing, ownGuest, signInThroughForm } from "../support/session";
import { sidebarLink } from "../support/shell";
import {
  begunStayListing,
  dayIn,
  endStayEarly,
  holdAndPay,
  writeReview,
} from "../support/stay";

test(
  "after a stay that is over, the host reviews the guest, finds it among the guest's reviews, and the guest finds it from their profile",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange, another }) => {
    // New on every attempt: on the deployment the guest is the suite's own, whose reviews
    // keep every earlier run's.
    const comment = `Left the place as they found it, and the keys on the hook (${Date.now().toString(36)}).`;
    const listing = await arrange.listing({
      pricePerNightCents: 10_000,
      ...begunStayListing(),
    });

    // The guest is the test's own: a review of them changes their account.
    const guest = await ownGuest(page, pages, "Ola Brennan");

    await openListing(page, pages, listing);
    await holdAndPay(page, pages, {
      from: dayIn(listing.timeZone),
      to: dayIn(listing.timeZone, 3),
      total: "$300.00",
    });
    await endStayEarly(page, pages);

    const hostPage = await another();

    await hostPage.goto(
      `/login?next=${encodeURIComponent("/bookings?side=HOST")}`,
    );
    await pages.check(hostPage);
    await signInThroughForm(hostPage, await arrange.host());

    const stay = hostPage
      .getByRole("listitem")
      .filter({ has: hostPage.getByRole("link", { name: listing.title }) });

    await expect(stay.getByText("Ended early", { exact: true })).toBeVisible();
    await pages.check(hostPage);

    await stay.getByRole("button", { name: "Review the guest" }).click();
    await writeReview(hostPage, pages, "How was the guest?", {
      stars: 4,
      comment,
    });
    await expect(stay.getByText("Reviewed", { exact: true })).toBeVisible();
    await pages.check(hostPage);

    // The host, from the stay, reads what hosts said about the guest — theirs among it.
    await stay.getByRole("link", { name: "Guest reviews" }).click();
    await expect(
      hostPage.getByRole("heading", {
        level: 1,
        name: `Reviews of ${guest.name}`,
      }),
    ).toBeVisible();
    await expect(hostPage.getByText(comment, { exact: true })).toBeVisible();
    await expect(hostPage.getByLabel("4 out of 5 stars").first()).toBeVisible();
    await pages.check(hostPage);

    // And the guest finds it from their own profile.
    await sidebarLink(page, "Profile").click();
    await expect(page).toHaveURL("/profile");
    await pages.check();
    await page.getByRole("link", { name: "Reviews of you" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Reviews of you" }),
    ).toBeVisible();
    await expect(page.getByText(comment, { exact: true })).toBeVisible();
    await pages.check();
  },
);
