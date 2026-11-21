import { GUEST } from "./demo";
import { expect, test } from "./fixtures";
import { EVERY_TARGET } from "./target";
import { signInThroughForm, signInToListing } from "./session";

test(
  "a guest writes to the host from the listing, the host sees it arrive and replies, and the guest sees the reply",
  { tag: EVERY_TARGET },
  async ({ page, pages, arrange, another }) => {
    const listing = await arrange.listing();
    // New on every attempt: the suite's accounts on the deployment keep every earlier
    // run's threads.
    const stamp = Date.now().toString(36);
    const question = `Is there somewhere to leave a bicycle overnight? (${stamp})`;
    const answer = `Yes — the shed by the gate, the code is on the door (${stamp}).`;

    // The host has their messages open before anything is written.
    const hostPage = await another();

    await hostPage.goto("/login?next=/messages");
    await pages.check(hostPage);
    await signInThroughForm(hostPage, await arrange.host());
    await expect(
      hostPage.getByRole("heading", { level: 1, name: "Messages" }),
    ).toBeVisible();
    await pages.check(hostPage);

    await signInToListing(page, pages, GUEST, listing);
    await page.getByLabel("Your question", { exact: true }).fill(question);
    await page.getByRole("button", { name: "Send to the host" }).click();

    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { level: 1, name: listing.title }),
    ).toBeVisible();
    await expect(page.getByText(question, { exact: true })).toBeVisible();
    await pages.check();

    // Without a reload: the thread arrives on the host's list, new, with the question on it.
    const thread = hostPage
      .getByRole("listitem")
      .filter({ has: hostPage.getByRole("link", { name: listing.title }) });

    await expect(thread).toBeVisible();
    await expect(thread.getByText("New", { exact: true })).toBeVisible();
    await expect(thread).toContainText(question);
    await expect(thread).toContainText(`With ${GUEST.name}`);
    await pages.check(hostPage);

    await thread.getByRole("link", { name: listing.title }).click();
    await expect(hostPage.getByText(question, { exact: true })).toBeVisible();
    await pages.check(hostPage);

    await hostPage.getByLabel("Your message", { exact: true }).fill(answer);
    await hostPage.getByRole("button", { name: "Send", exact: true }).click();
    await expect(hostPage.getByText(answer, { exact: true })).toBeVisible();
    await pages.check(hostPage);

    // And the guest, still on the thread, sees the reply come in without a reload.
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    await pages.check();
  },
);
