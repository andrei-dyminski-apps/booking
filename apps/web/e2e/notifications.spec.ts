import { GUEST } from "./demo";
import { expect, test } from "./fixtures";
import { EVERY_TARGET, TARGET } from "./target";
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

    // On the deployment the host is the suite's own, with the notices of every earlier run —
    // the stays its clean-up cancelled among them — so the count starts from none unread.
    // A notice of an earlier scenario — a payment's, the setup sweep's cancellations — may
    // still reach the host meanwhile and bring the button back, so it is pressed again
    // until it is gone; and for the same reason the bell is held there to this stay's two
    // at least, and only this listing's rows of the feed are counted.
    const live = TARGET === "live";
    const earlier = hostPage
      .getByRole("main")
      .getByRole("button", { name: "Mark all as read" });

    if (live) {
      await expect(async () => {
        if (await earlier.isVisible()) await earlier.click({ timeout: 5_000 });
        await expect(earlier).toBeHidden({ timeout: 5_000 });
      }).toPass({ timeout: 30_000 });
    } else {
      await expect(bell).toHaveAccessibleName("Notifications");
    }
    await pages.check(hostPage);

    // A hold on the listing, then its payment: a notice to the host for each.
    await signInToListing(page, pages, GUEST, listing);
    await holdAndPay(page, pages, {
      from: dayIn(listing.timeZone, 40),
      to: dayIn(listing.timeZone, 41),
      total: "$60.00",
    });

    // Without a reload, on the bell and in the list.
    await expect(bell).toHaveAccessibleName(
      live
        ? /^Notifications, (?:[2-9]|[1-9]\d+) unread$/
        : "Notifications, 2 unread",
    );

    // Every notice the host has on the local stacks, where the host is the test's own; this
    // listing's alone on the deployment.
    const notices = hostPage.getByRole("main").getByRole("listitem");
    const feed = live ? notices.filter({ hasText: listing.title }) : notices;

    await expect(
      feed.filter({ hasText: "New booking request (unread)" }),
    ).toContainText(listing.title);
    await expect(
      feed.filter({ hasText: "A stay was paid for (unread)" }),
    ).toContainText(listing.title);
    await pages.check(hostPage);

    await hostPage.getByRole("button", { name: "Mark all as read" }).click();

    if (!live) await expect(bell).toHaveAccessibleName("Notifications");
    await expect(feed.filter({ hasText: "(unread)" })).toHaveCount(0);
    await expect(feed).toHaveCount(2);
    await pages.check(hostPage);
  },
);
