import { z } from "zod";
export const mailGroupSchema = z.enum([
  "stays",
  "payments",
  "waitlist",
  "messages",
]);
export type MailGroup = z.infer<typeof mailGroupSchema>;
export const mailPreferencesSchema = z.object({
  muted: z.array(mailGroupSchema).max(4),
});
export const mailSettingsSchema = mailPreferencesSchema.extend({
  verified: z.boolean(),
  undeliverable: z.boolean(),
  canRequestConfirmation: z.boolean(),
});
export type MailSettings = z.infer<typeof mailSettingsSchema>;
export const confirmMailSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
});

/**
 * Addresses on the domains reserved for examples (RFC 2606), such as the demo accounts'.
 * No mail is ever sent to them, so a screen can say so instead of promising an email.
 */
export function isExampleMailAddress(email: string): boolean {
  return /@example\.(com|net|org)$/i.test(email);
}
