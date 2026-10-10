import type { ReviewPage } from "@repo/contracts";
import { ReviewCard, ReviewSummary } from "#entities/review";
import { DeleteReviewButton } from "#features/delete-review";

/**
 * What guests said about this listing: the summary of all of it, and the newest page.
 * Only the first page is drawn — a listing's screen is about the listing, and the summary
 * already speaks for the reviews below the fold. The removal is drawn for an admin only;
 * the API refuses it to anybody else either way. `null` is a read that failed, said as
 * such rather than as "no reviews yet", which would be a claim about the listing.
 */
export const ListingReviews = ({
  listingId,
  page,
  moderating,
}: {
  listingId: string;
  page: ReviewPage | null;
  moderating: boolean;
}) =>
  page === null ? (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold tracking-tight">Reviews</h2>
      <p className="text-sm text-muted-foreground">
        The reviews could not be loaded right now.
      </p>
    </div>
  ) : (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Reviews</h2>
        <ReviewSummary summary={page.summary} />
      </div>

      {page.items.length > 0 && (
        <ul role="list" className="flex flex-col gap-3">
          {page.items.map((review) => (
            <li key={review.id}>
              <ReviewCard
                review={review}
                action={
                  moderating ? (
                    <DeleteReviewButton
                      reviewId={review.id}
                      listingId={listingId}
                    />
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}

      {page.summary.count > page.items.length && (
        <p className="text-sm text-muted-foreground">
          The {page.items.length} most recent of {page.summary.count}.
        </p>
      )}
    </div>
  );
