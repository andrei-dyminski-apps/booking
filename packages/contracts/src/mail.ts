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
