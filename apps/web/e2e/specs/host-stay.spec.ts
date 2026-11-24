import { GUEST } from "../support/demo";
import { expect, test } from "../support/fixtures";
import { EVERY_TARGET } from "../target";
import { signInToListing } from "../support/session";
import { sidebarLink } from "../support/shell";
import { dayIn, dayLabel, holdAndPay } from "../support/stay";

test(
  "a guest pays for a stay and the host, in another browser, finds it on the calendar and among their bookings",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange, another }) => {
    const listing = await arrange.listing({ pricePerNightCents: 7_500 });
    const from = dayIn(listing.timeZone, 25);
    const to = dayIn(listing.timeZone, 27);
    const nights = [from, dayIn(listing.timeZone, 26)];

    await signInToListing(page, pages, GUEST, listing);
    await holdAndPay(page, pages, { from, to, total: "$150.00" });

    const hostPage = await another();

    await signInToListing(hostPage, pages, await arrange.host(), listing);
    await expect(hostPage.getByText(/^This is your listing\./)).toBeVisible();

    // The nights the guest took, drawn as booked. The calendar is a cached read the booking
    // marked stale, so the first page served may be the one before it: the host reloads.
    await expect(async () => {
      await hostPage.reload();
      for (const night of nights) {
        await expect(
          hostPage.getByText(`${dayLabel(night)}: booked`, { exact: true }),
        ).toBeAttached({ timeout: 1_000 });
      }
    }).toPass({ timeout: 10_000 });
    await expect(
      hostPage.getByText(`${dayLabel(to)}: free`, { exact: true }),
    ).toBeAttached();
    await pages.check(hostPage);

    await sidebarLink(hostPage, "Bookings").click();
    await hostPage.getByRole("link", { name: "Hosting" }).click();

    await expect(hostPage).toHaveURL("/bookings?side=HOST");
    await expect(
      hostPage.getByRole("heading", { level: 1, name: "Hosting" }),
    ).toBeVisible();

    const stay = hostPage
      .getByRole("listitem")
      .filter({ has: hostPage.getByRole("link", { name: listing.title }) });

    await expect(stay).toHaveCount(1);
    await expect(stay).toContainText(`${dayLabel(from)} → ${dayLabel(to)}`);
    await expect(stay).toContainText("$150.00");
    await expect(stay.getByText("Confirmed", { exact: true })).toBeVisible();
    await pages.check(hostPage);
  },
);
