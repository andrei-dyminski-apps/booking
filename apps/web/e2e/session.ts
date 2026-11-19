import type { Page } from "@playwright/test";
import { DEMO_PASSWORD, type DemoAccount } from "./demo";

/** Signs in through the form on the page that is open — `/login` or where a gate sent the visitor. */
export async function signInThroughForm(
  page: Page,
  account: DemoAccount,
): Promise<void> {
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}
