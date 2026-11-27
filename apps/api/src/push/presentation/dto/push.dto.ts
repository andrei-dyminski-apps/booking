import { createZodDto } from "nestjs-zod";
import {
  pushAccountQuerySchema,
  pushConfigSchema,
  pushMaintenanceSchema,
  pushPreferencesPatchSchema,
  pushPreferencesSchema,
  pushReceiptSchema,
  pushRegistrationSchema,
  pushSubscriptionStatusSchema,
  pushUnsubscribeSchema,
} from "@repo/contracts";
import { EXAMPLE_ID, withExample } from "../../../common/api-example";

const EXAMPLE_ENDPOINT = "https://fcm.googleapis.com/fcm/send/example";

export class PushAccountQueryDto extends createZodDto(pushAccountQuerySchema) {}

export class PushMaintenanceDto extends createZodDto(
  withExample(pushMaintenanceSchema, {
    accountId: "0b6f3c2e-4a1d-4e8b-9c7f-2d5a8e1b6f40",
    endpoint: EXAMPLE_ENDPOINT,
    auth: "tBHItJI5svbpez7KI4CCXg",
  }),
) {}

/** The request metatypes Nest needs, and the response shape `/docs` is handed — see `booking.dto.ts`. */
export class PushSubscriptionDto extends createZodDto(
  withExample(pushRegistrationSchema, {
    endpoint: EXAMPLE_ENDPOINT,
    keys: {
      p256dh:
        "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg",
    },
  }),
) {}

export class PushUnsubscribeDto extends createZodDto(
  withExample(pushUnsubscribeSchema, { endpoint: EXAMPLE_ENDPOINT }),
) {}

export class PushConfigDto extends createZodDto(pushConfigSchema) {}

export class PushSubscriptionStatusDto extends createZodDto(
  pushSubscriptionStatusSchema,
) {}

export class PushPreferencesDto extends createZodDto(
  withExample(pushPreferencesSchema, {
    muted: ["reviews"],
    quietHours: { from: "22:00", to: "07:00", timeZone: "Europe/Berlin" },
    hourlyLimit: 10,
  }),
) {}

export class PushReceiptDto extends createZodDto(
  withExample(pushReceiptSchema, {
    id: EXAMPLE_ID.pushDelivery,
    event: "received",
  }),
) {}

export class PushPreferencesPatchDto extends createZodDto(
  withExample(pushPreferencesPatchSchema, { groups: { reviews: false } }),
) {}
