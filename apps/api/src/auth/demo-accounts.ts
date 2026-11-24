import { DEMO_ACCOUNT_EMAILS } from "@repo/contracts";

export const DEMO_FIXTURE_EMAILS = {
  host: "ines@example.com",
  alex: "alex.morgan@example.com",
  otherAlex: "amorgan@example.com",
  sam: "sam@example.com",
} as const;

const publicDemoEmails = new Set<string>([
  ...Object.values(DEMO_ACCOUNT_EMAILS),
  ...Object.values(DEMO_FIXTURE_EMAILS),
]);

export function isDemoEmail(email: string): boolean {
  return publicDemoEmails.has(email.toLowerCase());
}
