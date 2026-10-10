import type { ReactNode } from "react";
import type { Review } from "@repo/contracts";
import { Card, CardContent } from "@repo/ui/components/card";
import { formatDate } from "#shared/lib";
import { RatingStars } from "./rating-stars";

/**
 * One review, as both lists draw it. There is no author on it because the contract has
 * none: who wrote a review of a listing is a guest, and the only thing an account carries
 * that would name them is an address that is not a stranger's to read.
 *
 * `action` is the slot the admin's removal goes in — this card renders what a review is
 * and leaves what may be done to it to the screen, which knows who is looking.
 */
export const ReviewCard = ({
  review,
  action,
}: {
  review: Review;
  action?: ReactNode;
}) => (
  <Card size="sm">
    <CardContent className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <RatingStars rating={review.rating} />
          <time
            dateTime={review.createdAt}
            className="text-xs text-muted-foreground"
          >
            {formatDate(review.createdAt)}
          </time>
        </div>
        {action}
      </div>
      <p className="text-sm whitespace-pre-line break-words">
        {review.comment}
      </p>
    </CardContent>
  </Card>
);
