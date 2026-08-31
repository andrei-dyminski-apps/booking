import { createZodDto } from "nestjs-zod";
import {
  bookingPageSchema,
  bookingQuerySchema,
  bookingSchema,
  createBookingSchema,
} from "@repo/contracts";

/**
 * Nest needs a class as the runtime metatype of the parameter — the schemas themselves
 * live in @repo/contracts. A request body needs one for that reason; a response type
 * does not, because a TypeScript return type is not something Swagger can read either —
 * `BookingDto` below exists only to be handed to `@ApiOkResponse`/`@ApiCreatedResponse`,
 * the controller itself keeps returning the contract type `Booking`.
 */
export class CreateBookingDto extends createZodDto(createBookingSchema) {}

export class BookingDto extends createZodDto(bookingSchema) {}

/**
 * A query string is a request the pipe validates like any other, and the DTO is what makes
 * `@Query()` reach it — the same class is also what puts the filters in `/docs`, which no
 * TypeScript parameter type could.
 */
export class BookingQueryDto extends createZodDto(bookingQuerySchema) {}

export class BookingPageDto extends createZodDto(bookingPageSchema) {}
