import { mailSettingsSchema, type MailGroup } from "@repo/contracts";
import { z } from "zod";
import { apiRequest } from "./http-client";
export const mailApi = {
  settings: () =>
    apiRequest({
      method: "GET",
      path: "/mail/settings",
      schema: mailSettingsSchema,
      read: { cache: "no-store" },
    }),
  preferences: (muted: MailGroup[]) =>
    apiRequest({
      method: "PATCH",
      path: "/mail/settings",
      body: { muted },
      schema: z.void(),
    }),
  resend: () =>
    apiRequest({ method: "POST", path: "/mail/resend", schema: z.void() }),
  confirm: (token: string) =>
    apiRequest({
      method: "POST",
      path: "/mail/confirm",
      body: { token },
      schema: z.void(),
    }),
};
