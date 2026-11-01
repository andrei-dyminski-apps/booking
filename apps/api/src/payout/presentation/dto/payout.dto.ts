import { createZodDto } from "nestjs-zod";
import { accountSessionSchema, hostAccountSchema } from "@repo/contracts";

/** Response shapes for `/docs` only — see `booking.dto.ts` for why they are classes. */
export class HostAccountDto extends createZodDto(hostAccountSchema) {}

export class AccountSessionDto extends createZodDto(accountSessionSchema) {}
