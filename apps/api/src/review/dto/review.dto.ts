import { createZodDto } from "nestjs-zod";
import {
  createReviewSchema,
  reviewPageSchema,
  reviewQuerySchema,
  reviewSchema,
} from "@repo/contracts";
import { withExample } from "../../common/api-example";

/** The request metatypes Nest needs, and the response shapes `/docs` is handed — see `booking.dto.ts`. */
export class CreateReviewDto extends createZodDto(
  withExample(createReviewSchema, {
    rating: 5,
    comment:
      "Quiet street, spotless kitchen, and the host answered within minutes.",
  }),
) {}

export class ReviewQueryDto extends createZodDto(reviewQuerySchema) {}

export class ReviewDto extends createZodDto(reviewSchema) {}

export class ReviewPageDto extends createZodDto(reviewPageSchema) {}
