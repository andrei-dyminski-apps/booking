import { createZodDto } from "nestjs-zod";
import {
  availabilityQuerySchema,
  createListingSchema,
  listingAvailabilitySchema,
  listingDetailSchema,
  listingPageSchema,
  listingQuerySchema,
  listingSchema,
  updateListingSchema,
} from "@repo/contracts";
import { withExample } from "../../common/api-example";

/**
 * Nest needs a class as the runtime metatype of the parameter — the schemas themselves
 * live in @repo/contracts. A request body needs one for that reason; a response type
 * does not, because a TypeScript return type is not something Swagger can read either —
 * `ListingDto` below exists only to be handed to `@ApiOkResponse`/`@ApiCreatedResponse`,
 * the controller itself keeps returning the contract type `Listing`.
 */
export class CreateListingDto extends createZodDto(
  withExample(createListingSchema, {
    title: "Sunny loft by the canal",
    description:
      "A top-floor loft with a balcony over the water, a full kitchen and a desk by the window.",
    pricePerNightCents: 12_000,
    capacity: 3,
    cancellationPolicy: "MODERATE",
    nonRefundableDiscountBps: 1_000,
    timeZone: "Europe/Amsterdam",
    checkInTime: "15:00",
    pricing: { weekdays: { fri: 14_000, sat: 14_000 }, dates: [] },
  }),
) {}

export class UpdateListingDto extends createZodDto(
  withExample(updateListingSchema, { pricePerNightCents: 13_500, capacity: 4 }),
) {}

export class ListingDto extends createZodDto(listingSchema) {}

/** `GET /listings/:id` alone: the row and the exceptions to its price. */
export class ListingDetailDto extends createZodDto(listingDetailSchema) {}

/**
 * A query string is a request the pipe validates like any other, and the DTO is what makes
 * `@Query()` reach it — the same class is also what puts the filters in `/docs`, which no
 * TypeScript parameter type could.
 */
export class ListingQueryDto extends createZodDto(listingQuerySchema) {}

export class AvailabilityQueryDto extends createZodDto(
  availabilityQuerySchema,
) {}

export class ListingPageDto extends createZodDto(listingPageSchema) {}

export class ListingAvailabilityDto extends createZodDto(
  listingAvailabilitySchema,
) {}
