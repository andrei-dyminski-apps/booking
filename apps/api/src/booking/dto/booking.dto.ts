import { createZodDto } from "nestjs-zod";
import { bookingSchema, createBookingSchema } from "@repo/contracts";

/** Nest needs a class as the runtime metatype of the parameter — the schemas themselves live in @repo/contracts. */
export class CreateBookingDto extends createZodDto(createBookingSchema) {}

export class BookingDto extends createZodDto(bookingSchema) {}
