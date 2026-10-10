import { reviewSchema, reviewSortSchema } from "@repo/contracts";
import type { Review, ReviewKind, ReviewSort } from "@repo/contracts";
import {
  decodeParts,
  encodeParts,
  type CreatedAtCursor,
} from "../common/paging";

/**
 * The place in a list of reviews a page ends — keyset, ordered by when a review was
 * written, for the reason every list here is: a review written while somebody is paging
 * lands at the top of `newest` and would shift every offset after it.
 */
export type ReviewCursor = CreatedAtCursor;

/**
 * The tag carries the kind, because there are two lists of reviews and they spell their
 * cursors identically: a moment and a uuid. Without it a cursor of a listing's reviews
 * would read as a place among a guest's, which is the mistake the resource tag of
 * `src/common/paging.ts` exists to refuse.
 */
const resourceOf = (kind: ReviewKind): string => `reviews-${kind}`;

export function encodeCursor(review: Review, sort: ReviewSort): string {
  return encodeParts(
    resourceOf(review.kind),
    sort,
    review.createdAt,
    review.id,
  );
}

/**
 * `null` for anything this cannot read, which the caller answers with a `400`. The key is
 * read against the contract's rule for `createdAt`, so a cursor cannot name a moment no
 * review could have been written at.
 */
export function decodeCursor(
  kind: ReviewKind,
  raw: string,
): ReviewCursor | null {
  const parts = decodeParts(resourceOf(kind), raw, {
    sort: reviewSortSchema,
    id: reviewSchema.shape.id,
  });

  if (parts === null) return null;

  const createdAt = reviewSchema.shape.createdAt.safeParse(parts.key);

  return createdAt.success
    ? { sort: parts.sort, createdAt: new Date(createdAt.data), id: parts.id }
    : null;
}
