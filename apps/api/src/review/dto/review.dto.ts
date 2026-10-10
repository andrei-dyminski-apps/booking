import { createZodDto } from "nestjs-zod";
import {
  createReviewSchema,
  reviewPageSchema,
  reviewQuerySchema,
  reviewSchema,
} from "@repo/contracts";

/** The request metatypes Nest needs, and the response shapes `/docs` is handed — see `booking.dto.ts`. */
export class CreateReviewDto extends createZodDto(createReviewSchema) {}

export class ReviewQueryDto extends createZodDto(reviewQuerySchema) {}

export class ReviewDto extends createZodDto(reviewSchema) {}

export class ReviewPageDto extends createZodDto(reviewPageSchema) {}
