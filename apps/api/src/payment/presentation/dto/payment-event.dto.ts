import { createZodDto } from "nestjs-zod";
import {
  failedPaymentEventPageSchema,
  failedPaymentEventQuerySchema,
} from "@repo/contracts";

export class FailedPaymentEventQueryDto extends createZodDto(
  failedPaymentEventQuerySchema,
) {}

export class FailedPaymentEventPageDto extends createZodDto(
  failedPaymentEventPageSchema,
) {}
