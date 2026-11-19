import type { Page } from "@playwright/test";
import { expect, type Pages } from "./fixtures";
import { DEMO_PASSWORD, type Account } from "./demo";

/** Signs in through the form on the page that is open — `/login` or where a gate sent the visitor. */
export async function signInThroughForm(
  page: Page,
  account: Account,
): Promise<void> {
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(account.password ?? DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Signs in on the way to a listing — the sign-in page sends the visitor on to it — and
 * waits for the listing's page.
 */
export async function signInToListing(
  page: Page,
  pages: Pages,
  account: Account,
  listing: { id: string; title: string },
): Promise<void> {
  await page.goto(`/login?next=/listings/${listing.id}`);
  await pages.check(page);
  await signInThroughForm(page, account);
  await expectListing(page, pages, listing);
}

/** Opens a listing's page by its address, for a visitor already signed in. */
export async function openListing(
  page: Page,
  pages: Pages,
  listing: { id: string; title: string },
): Promise<void> {
  await page.goto(`/listings/${listing.id}`);
  await expectListing(page, pages, listing);
}

async function expectListing(
  page: Page,
  pages: Pages,
  listing: { title: string },
): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 1, name: listing.title }),
  ).toBeVisible();
  await pages.check(page);
}

/**
 * Registers an account of the test's own through the sign-up page — new on every attempt,
 * since an address once registered stays taken — and lands signed in on its profile.
 */
export async function registerThroughForm(
  page: Page,
  pages: Pages,
  name: string,
): Promise<Account> {
  const password = "a-new-password";
  const account: Account = {
    name,
    email: `${name.toLowerCase().replaceAll(/\W+/g, "-")}-${String(Date.now())}@e2e.example`,
    password,
  };

  await page.goto("/register");
  await pages.check(page);
  await fillRegistration(page, account.name, account.email, password);

  await expect(page).toHaveURL("/profile");
  await pages.check(page);

  return account;
}

/** On the sign-up page: fills the form in, the password twice, and creates the account. */
export async function fillRegistration(
  page: Page,
  name: string,
  email: string,
  password: string,
): Promise<void> {
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Repeat password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}
