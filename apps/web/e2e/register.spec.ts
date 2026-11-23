import { z } from "zod";
import { expect, test } from "./fixtures";
import { fillRegistration } from "./session";

test("a new visitor registers and lands signed in under their own name", async ({
  request,
  page,
  pages,
}) => {
  // New on every attempt: an address once registered stays taken.
  const name = "Robin Ashdown";
  const email = `robin-${String(Date.now())}@e2e.example`;

  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /Rooms, dates and guests/ }),
  ).toBeVisible();
  await pages.check();

  await page.getByRole("link", { name: "Create an account" }).click();

  await expect(page).toHaveURL("/register");
  await expect(page).toHaveTitle(/^Create an account · /);
  await expect(
    page.getByRole("button", { name: "Create account" }),
  ).toBeVisible();
  await pages.check();

  await fillRegistration(page, name, email, "a-new-password");

  await expect(page).toHaveURL("/profile");

  const details = page.getByRole("main");

  await expect(details.getByText(name, { exact: true })).toBeVisible();
  await expect(details.getByText(email, { exact: true })).toBeVisible();
  await expect(
    details.getByRole("button", { name: "Resend confirmation" }),
  ).toBeVisible();
  // The shell's link to the account, named after it.
  await expect(
    page.getByRole("link", { name: new RegExp(name) }),
  ).toBeVisible();
  await pages.check();

  const inbox = "http://127.0.0.1:8026/api/v1";
  let letterId: string | undefined;
  await expect
    .poll(async () => {
      const response = await request.get(inbox + "/search", {
        params: { query: "to:" + email },
      });
      const results = z
        .object({ messages: z.array(z.object({ ID: z.string() })) })
        .parse(await response.json());
      letterId = results.messages[0]?.ID;
      return letterId;
    })
    .toBeTruthy();
  const response = await request.get(inbox + "/message/" + String(letterId));
  const letter = z.object({ Text: z.string() }).parse(await response.json());
  const link = letter.Text.match(
    /https?:\/\/[^\s]+\/confirm-email#[a-f0-9]{64}/,
  )?.[0];
  if (!link) throw new Error("Confirmation email has no link");
  await page.goto(link);
  await pages.check();
  const confirm = page.getByRole("button", { name: "Confirm email" });
  const status = page.getByRole("main").getByRole("status");
  pages.expectResponse({ status: 503, path: "/api/mail/confirm" });
  await page.route(
    "**/api/mail/confirm",
    (route) =>
      route.fulfill({
        status: 503,
        json: {
          statusCode: 503,
          code: "SERVICE_UNAVAILABLE",
          message: "Confirmation is temporarily unavailable.",
        },
      }),
    { times: 1 },
  );
  await confirm.click();
  await expect(status).toHaveText("Confirmation is temporarily unavailable.");
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Email confirmed" }),
  ).toBeVisible();
  await expect(status).toBeEmpty();
  await page.getByRole("link", { name: "Go to profile" }).click();
  await expect(page).toHaveURL("/profile");
  await expect(
    page.getByText("Email confirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resend confirmation" }),
  ).toHaveCount(0);
});
