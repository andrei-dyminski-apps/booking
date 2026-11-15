import { createZodDto } from "nestjs-zod";
import {
  adminRefundSchema,
  bookingAdjustmentListSchema,
  bookingAdjustmentSchema,
  bookingDetailSchema,
  bookingPageSchema,
  bookingPaymentSchema,
  bookingQuerySchema,
  bookingSchema,
  cancelBookingSchema,
  createBookingSchema,
  endStayEarlySchema,
  refundFailurePageSchema,
  refundFailureQuerySchema,
  resolveRefundFailureSchema,
  stuckStayPageSchema,
  stuckStayQuerySchema,
} from "@repo/contracts";
import {
  EXAMPLE_ID,
  exampleDay,
  withExample,
} from "../../../common/api-example";

/**
 * Nest needs a class as the runtime metatype of the parameter — the schemas themselves
 * live in @repo/contracts. A request body needs one for that reason; a response type
 * does not, because a TypeScript return type is not something Swagger can read either —
 * `BookingDto` below exists only to be handed to `@ApiOkResponse`/`@ApiCreatedResponse`,
 * the controller itself keeps returning the contract type `Booking`.
 */
export class CreateBookingDto extends createZodDto(
  withExample(createBookingSchema, {
    listingId: EXAMPLE_ID.listing,
    from: exampleDay(30),
    to: exampleDay(33),
    rate: "STANDARD",
  }),
) {}

/**
 * Optional as a whole: `DELETE` usually travels without a body, and a missing one is the
 * same as an empty one.
 */
export class CancelBookingDto extends createZodDto(
  withExample(cancelBookingSchema.default({}), {
    reason: "Our flight was cancelled.",
  }),
) {}

export class EndStayEarlyDto extends createZodDto(
  // `refundCents` has to be the one the stay quotes for that check-out, or it is refused.
  withExample(endStayEarlySchema, {
    checkOut: exampleDay(1),
    refundCents: 24_000,
  }),
) {}

export class BookingDto extends createZodDto(bookingSchema) {}

export class BookingDetailDto extends createZodDto(bookingDetailSchema) {}

/**
 * A query string is a request the pipe validates like any other, and the DTO is what makes
 * `@Query()` reach it — the same class is also what puts the filters in `/docs`, which no
 * TypeScript parameter type could.
 */
export class BookingQueryDto extends createZodDto(bookingQuerySchema) {}

export class BookingPageDto extends createZodDto(bookingPageSchema) {}

export class BookingPaymentDto extends createZodDto(bookingPaymentSchema) {}

export class AdminRefundDto extends createZodDto(
  withExample(adminRefundSchema, {
    amountCents: 5_000,
    reason: "The hot water was out for a night.",
    requestId: EXAMPLE_ID.request,
  }),
) {}

export class BookingAdjustmentDto extends createZodDto(
  bookingAdjustmentSchema,
) {}

export class BookingAdjustmentListDto extends createZodDto(
  bookingAdjustmentListSchema,
) {}

export class StuckStayQueryDto extends createZodDto(stuckStayQuerySchema) {}

export class StuckStayPageDto extends createZodDto(stuckStayPageSchema) {}

export class RefundFailureQueryDto extends createZodDto(
  refundFailureQuerySchema,
) {}

export class RefundFailurePageDto extends createZodDto(
  refundFailurePageSchema,
) {}

export class ResolveRefundFailureDto extends createZodDto(
  withExample(resolveRefundFailureSchema, {
    resolution: "Sent back by bank transfer to the guest's new account.",
  }),
) {}
