import { createZodDto } from "nestjs-zod";
import { apiErrorSchema } from "@repo/contracts";

/**
 * The body of every non-2xx answer, for the error responses declared in Swagger
 * (`@ApiNotFoundResponse({ type: ApiErrorDto })` and so on) — not a request DTO, so it is
 * never a route parameter type.
 */
export class ApiErrorDto extends createZodDto(apiErrorSchema) {}
