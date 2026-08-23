import { createZodDto } from "nestjs-zod";
import { bookingSchema, createBookingSchema } from "@repo/contracts";

/**
 * Nest needs a class as the runtime metatype of the parameter — the schemas themselves
 * live in @repo/contracts. A request body needs one for that reason; a response type
 * does not, because a TypeScript return type is not something Swagger can read either —
 * `BookingDto` below exists only to be handed to `@ApiOkResponse`/`@ApiCreatedResponse`,
 * the controller itself keeps returning the contract type `Booking`.
 */
export class CreateBookingDto extends createZodDto(createBookingSchema) {}

export class BookingDto extends createZodDto(bookingSchema) {}
