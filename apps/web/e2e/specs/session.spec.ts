import { DEMO, DEMO_PASSWORD, GUEST } from "../support/demo";
import { expect, test } from "../support/fixtures";
import { EVERY_TARGET, TARGET } from "../target";
import { signInThroughForm } from "../support/session";

test("guest account pages and links disappear after sign-in", async ({
  page,
  pages,
}) => {
  await page.goto("/");
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: "Sign up", exact: true }),
  ).toBeVisible();
  await pages.check();

  await page.getByRole("link", { name: "Sign in as demo guest" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    GUEST.email,
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    DEMO_PASSWORD,
  );
  await pages.check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/listings");
  await pages.check();

  for (const path of [
    "/login?next=/bookings",
    "/register",
    "/complete-registration",
    "/forgot-password",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL("/profile");
  }
  await pages.check();

  await page.goto("/");
  await expect(
    page.locator('a[href="/login"], a[href="/register"]'),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Sign in as demo/ })).toHaveCount(
    0,
  );
  await pages.check();
});

const demoShortcuts = [
  { role: "host", account: DEMO.host, destination: "/dashboard" },
  { role: "admin", account: DEMO.admin, destination: "/admin/payments" },
] as const;

for (const { role, account, destination } of demoShortcuts) {
  test(`the demo ${role} signs in from the home page and reaches ${destination}`, async ({
    page,
    pages,
  }) => {
    await page.goto("/");
    await pages.check();

    await page.getByRole("link", { name: `Sign in as demo ${role}` }).click();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
      account.email,
    );
    await pages.check();

    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(destination);
    await pages.check();
  });
}

test(
  "a demo account signs in, finds its details and signs out",
  { tag: EVERY_TARGET },
  async ({ page, pages }) => {
    const guest = GUEST;

    // Zod catches its eval probe failure, so it only surfaces as a CSP event.
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        if (event.blockedURI === "eval") {
          console.error("An eval probe violated the Content Security Policy");
        }
      });
    });

    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await pages.check();

    await signInThroughForm(page, guest);

    await expect(page).toHaveURL("/profile");

    // The shell's link to the account, named after it.
    const account = page.getByRole("link", { name: new RegExp(guest.name) });

    await expect(account).toBeVisible();

    const details = page.getByRole("main");

    await expect(details.getByText(guest.name, { exact: true })).toBeVisible();
    await expect(details.getByText(guest.email, { exact: true })).toBeVisible();

    // The day the account was opened, on the reader's clock rather than the server's.
    await expect(
      details.getByText(guest.joined, { exact: true }),
    ).toBeVisible();
    await pages.check();

    // A demo address never receives mail: the contract refuses the link, and the dialog says why.
    // On the deployment the guest is the suite's own, whose address does get a link.
    if (TARGET !== "live") {
      await details.getByRole("button", { name: "Change password" }).click();

      const passwordDialog = page.getByRole("dialog", {
        name: "Change password",
      });

      await passwordDialog
        .getByRole("button", { name: "Send reset link" })
        .click();
      await expect(passwordDialog.getByRole("alert")).toContainText(
        "Demo accounts cannot change password",
      );
      await expect(passwordDialog.getByRole("status")).toHaveCount(0);
      await pages.check();

      await passwordDialog.getByRole("button", { name: "Close" }).click();
      await expect(passwordDialog).toHaveCount(0);
    }

    await details.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL("/");
    await expect(account).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Sign in" }).first(),
    ).toBeVisible();
    await pages.check();

    await page.goto("/profile");

    await expect(page).toHaveURL("/login?next=%2Fprofile");
  },
);

test(
  "a page behind the session sends a stranger to sign in and then on to it",
  { tag: EVERY_TARGET },
  async ({ page, pages }) => {
    await page.goto("/bookings");

    await expect(page).toHaveURL("/login?next=%2Fbookings");
    await pages.check();

    await signInThroughForm(page, GUEST);

    await expect(page).toHaveURL("/bookings");
    await expect(
      page.getByRole("heading", { level: 1, name: "Your trips" }),
    ).toBeVisible();
    await pages.check();
  },
);
