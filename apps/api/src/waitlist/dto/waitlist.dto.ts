import { createZodDto } from "nestjs-zod";
import {
  joinWaitlistSchema,
  waitlistDemandPageSchema,
  waitlistDemandQuerySchema,
  waitlistEntrySchema,
  waitlistSchema,
} from "@repo/contracts";

/** The request metatype Nest needs, and the response shapes `/docs` is handed — see `booking.dto.ts`. */
export class JoinWaitlistDto extends createZodDto(joinWaitlistSchema) {}

export class WaitlistEntryDto extends createZodDto(waitlistEntrySchema) {}

export class WaitlistDto extends createZodDto(waitlistSchema) {}

export class WaitlistDemandQueryDto extends createZodDto(
  waitlistDemandQuerySchema,
) {}

export class WaitlistDemandPageDto extends createZodDto(
  waitlistDemandPageSchema,
) {}
