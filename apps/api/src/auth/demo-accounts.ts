export const DEMO_EMAILS = {
  guest: "guest@example.com",
  owner: "owner@example.com",
  admin: "admin@example.com",
  host: "ines@example.com",
  alex: "alex.morgan@example.com",
  otherAlex: "amorgan@example.com",
  sam: "sam@example.com",
} as const;

const publicDemoEmails = new Set<string>(Object.values(DEMO_EMAILS));

export function isDemoEmail(email: string): boolean {
  return publicDemoEmails.has(email.toLowerCase());
}
