import { createZodDto } from "nestjs-zod";
import {
  notificationPageSchema,
  notificationQuerySchema,
  unreadCountSchema,
} from "@repo/contracts";

/** The request metatypes Nest needs, and the response shapes `/docs` is handed — see `booking.dto.ts`. */
export class NotificationQueryDto extends createZodDto(
  notificationQuerySchema,
) {}

export class NotificationPageDto extends createZodDto(notificationPageSchema) {}

export class UnreadCountDto extends createZodDto(unreadCountSchema) {}
