import { DEMO, GUEST } from "./demo";
import { expect, test } from "./fixtures";
import { EVERY_TARGET } from "./target";
import { signInThroughForm } from "./session";

test(
  "a guest opening the admin's pages or a host's listing is turned away and shown none of it",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange }) => {
    const listing = await arrange.listing({
      // No character HTML escapes, so the title would be found in the document as written.
      title: "A listing of the test host, closed to its guests",
    });

    await page.goto("/login");
    await pages.check();
    await signInThroughForm(page, GUEST);
    await expect(page).toHaveURL("/profile");
    await pages.check();

    // Each refusal is the not-found page, and the document the server sent carries nothing of
    // the screen behind it, so nothing of it can flash before it is gone. Whether the answer
    // is a 404 or a stream that settles on the not-found page is how it is rendered, so the
    // test reads what was sent rather than its status.
    const refusals = [
      {
        path: "/admin",
        content: ["An admin may edit or retire any of them", "Filters"],
      },
      {
        path: "/admin/users",
        content: ["Every account, newest first", DEMO.host.email, "Filters"],
      },
      {
        path: "/admin/payments",
        content: ["what the background jobs gave up on"],
      },
      {
        path: `/dashboard/listings/${listing.id}`,
        content: [listing.title, "Save changes", "Default price per night"],
      },
    ];

    for (const { path, content } of refusals) {
      pages.expectResponse({ status: 404, path });

      const response = await page.goto(path);

      if (response === null)
        throw new Error(`${path} answered with no document`);

      const document = await response.text();

      for (const text of content) {
        expect(document, `${path} sent "${text}"`).not.toContain(text);
      }

      await expect(
        page.getByText("There is nothing at this address"),
      ).toBeVisible();
      for (const text of content) {
        await expect(page.getByText(text)).toHaveCount(0);
      }
      await pages.check();
    }
  },
);
