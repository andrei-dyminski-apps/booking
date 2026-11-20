import { DEMO } from "./demo";
import { expect, test } from "./fixtures";
import { EVERY_TARGET } from "./target";
import { signInThroughForm, signInToListing } from "./session";
import { dayIn, holdAndPay } from "./stay";

test(
  "a guest books a host's listing, the host's bell counts the notices, the page lists them and marking all read clears the count",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange, another }) => {
    const listing = await arrange.listing({ pricePerNightCents: 6_000 });

    // The host, with nothing to read yet, has their notifications open.
    const hostPage = await another();

    await hostPage.goto("/login?next=/notifications");
    await pages.check(hostPage);
    await signInThroughForm(hostPage, await arrange.host());

    const bell = hostPage.getByRole("button", { name: /^Notifications/ });

    await expect(
      hostPage.getByRole("heading", { level: 1, name: "Notifications" }),
    ).toBeVisible();
    await expect(bell).toHaveAccessibleName("Notifications");
    await pages.check(hostPage);

    // A hold on the listing, then its payment: a notice to the host for each.
    await signInToListing(page, pages, DEMO.guest, listing);
    await holdAndPay(page, pages, {
      from: dayIn(listing.timeZone, 40),
      to: dayIn(listing.timeZone, 41),
      total: "$60.00",
    });

    // Without a reload, on the bell and in the list.
    await expect(bell).toHaveAccessibleName("Notifications, 2 unread");

    const feed = hostPage.getByRole("main").getByRole("listitem");

    await expect(
      feed.filter({ hasText: "New booking request (unread)" }),
    ).toContainText(listing.title);
    await expect(
      feed.filter({ hasText: "A stay was paid for (unread)" }),
    ).toContainText(listing.title);
    await pages.check(hostPage);

    await hostPage.getByRole("button", { name: "Mark all as read" }).click();

    await expect(bell).toHaveAccessibleName("Notifications");
    await expect(feed.filter({ hasText: "(unread)" })).toHaveCount(0);
    await expect(feed).toHaveCount(2);
    await pages.check(hostPage);
  },
);
