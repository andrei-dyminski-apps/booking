import { createZodDto } from "nestjs-zod";
import {
  mailPreferencesSchema,
  confirmMailSchema,
  mailSettingsSchema,
} from "@repo/contracts";
import { withExample } from "../../../common/api-example";
export class MailPreferencesDto extends createZodDto(
  withExample(mailPreferencesSchema, { muted: ["messages"] }),
) {}
export class ConfirmMailDto extends createZodDto(
  withExample(confirmMailSchema, { token: "a".repeat(64) }),
) {}
export class MailSettingsDto extends createZodDto(mailSettingsSchema) {}
