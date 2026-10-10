import { LookupKind, Role } from "@repo/contracts";
import { ReviewCard, ReviewSummary } from "#entities/review";
import { DeleteReviewButton } from "#features/delete-review";
import { lookupsApi, requireUser } from "#shared/api";
import { ROUTES } from "#shared/config";
import { lookupOptionText, requireId, singleParam } from "#shared/lib";
import { BackLink, PageHeading, Pager, StalePageNotice } from "#shared/ui";
import { readGuestReviews } from "../api/read-guest-reviews";

const PAGE_SIZE = 20;

/**
 * What hosts said about one guest — the half of the two-sided review that is not public.
 * Reached from a stay on the host's list ("Guest reviews"), from an admin's, and by the
 * guest from their profile. Who may look is the API's answer, and everybody else is shown
 * the same not-found an id that names nobody is.
 *
 * The only parameter is the cursor: the list has one ordering worth offering, newest
 * first, and a screen with no filters has no canonical address to redirect to.
 */
export const GuestReviewsPage = async ({
  params,
  searchParams,
}: PageProps<"/guests/[id]/reviews">) => {
  const id = requireId((await params).id);
  const viewer = await requireUser(ROUTES.guestReviews(id));
  const cursor = singleParam((await searchParams).cursor) || undefined;
  // Lower-cased for the reason the API's own-account check is: the route accepts an
  // upper-case uuid that names the same account, and the id in the session is lower-case.
  const self = viewer.id === id.toLowerCase();

  // The guest's own page needs no name; anybody else's is named by the same lookup the
  // stays' filter box reads, which answers only for guests this viewer may see anyway —
  // with the address beside the name for an admin, as the chips spell it.
  const [page, option] = await Promise.all([
    readGuestReviews(id, { sort: "newest", limit: PAGE_SIZE, cursor }),
    self ? undefined : lookupsApi.optionOf(LookupKind.guests, id),
  ]);
  const name = option === undefined ? undefined : lookupOptionText(option);

  const first = ROUTES.guestReviews(id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <BackLink href={self ? ROUTES.profile : ROUTES.bookings}>
          {self ? "Profile" : "Stays"}
        </BackLink>
        <PageHeading
          title={self ? "Reviews of you" : `Reviews of ${name ?? "this guest"}`}
          description="What hosts said after a stay. Only the guest, the hosts they ask to stay with and the site's admins can read these."
        />
      </div>

      {page === null ? (
        <StalePageNotice firstPageHref={first} />
      ) : (
        <>
          <ReviewSummary summary={page.summary} />

          {page.items.length > 0 && (
            <ul role="list" className="flex flex-col gap-3">
              {page.items.map((review) => (
                <li key={review.id}>
                  <ReviewCard
                    review={review}
                    action={
                      viewer.role === Role.ADMIN ? (
                        <DeleteReviewButton
                          reviewId={review.id}
                          listingId={null}
                        />
                      ) : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          )}

          <Pager
            nextHref={
              page.nextCursor === null
                ? null
                : `${first}?cursor=${encodeURIComponent(page.nextCursor)}`
            }
            firstHref={cursor === undefined ? null : first}
          />
        </>
      )}
    </div>
  );
};
