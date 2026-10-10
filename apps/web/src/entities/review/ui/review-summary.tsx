import type { ReviewSummary as Summary } from "@repo/contracts";
import { countOf } from "#shared/lib";
import { RatingStars } from "./rating-stars";

/**
 * The mean and the count of every review, not of the page on the screen — the API works
 * both out over the whole list. Nothing to average reads as such rather than as zero
 * stars, which would be the worst score anybody can give.
 */
export const ReviewSummary = ({ summary }: { summary: Summary }) =>
  summary.average === null ? (
    <p className="text-sm text-muted-foreground">No reviews yet.</p>
  ) : (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <RatingStars rating={summary.average} />
      <span className="font-medium">{summary.average.toFixed(1)}</span>
      <span className="text-muted-foreground">
        from {countOf(summary.count, "review")}
      </span>
    </div>
  );
