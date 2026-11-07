import { createZodDto } from "nestjs-zod";
import {
  accountSessionSchema,
  hostAccountSchema,
  hostFeeOverviewSchema,
  hostFeeQuerySchema,
  waiveHostFeeSchema,
} from "@repo/contracts";

/** Response shapes for `/docs` only — see `booking.dto.ts` for why they are classes. */
export class HostAccountDto extends createZodDto(hostAccountSchema) {}

export class AccountSessionDto extends createZodDto(accountSessionSchema) {}

export class HostFeeOverviewDto extends createZodDto(hostFeeOverviewSchema) {}

export class HostFeeQueryDto extends createZodDto(hostFeeQuerySchema) {}

export class WaiveHostFeeDto extends createZodDto(waiveHostFeeSchema) {}
