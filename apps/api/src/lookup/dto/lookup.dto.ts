import { createZodDto } from "nestjs-zod";
import { lookupPageSchema, lookupQuerySchema } from "@repo/contracts";

/** The request half, which the global pipe validates — see `booking.dto.ts` for why a class. */
export class LookupQueryDto extends createZodDto(lookupQuerySchema) {}

/** The response half, for `/docs` only: the controller keeps returning the contract type. */
export class LookupPageDto extends createZodDto(lookupPageSchema) {}
