import { createZodDto } from "nestjs-zod";
import { createListingSchema, updateListingSchema } from "@repo/contracts";

/**
 * Nest needs a class as the runtime metatype of the parameter — the schemas themselves
 * live in @repo/contracts. Only a request body needs one: a response leaves as the
 * contract type, and a class named after it would document nothing, because a TypeScript
 * return type is not something Swagger can read.
 */
export class CreateListingDto extends createZodDto(createListingSchema) {}

export class UpdateListingDto extends createZodDto(updateListingSchema) {}
