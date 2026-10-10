import { ReviewKind, type Review, type ReviewSort } from "@repo/contracts";
import { encodeParts } from "../common/paging";
import { decodeCursor, encodeCursor } from "./review-cursor";

const review: Review = {
  id: "4d5e6f70-8192-4a3b-8c4d-5e6f708192a3",
  kind: ReviewKind.LISTING,
  rating: 5,
  comment: "Quiet, warm and exactly as described.",
  createdAt: "2026-09-12T08:30:00.000Z",
};

/** A cursor of this resource, spelled by hand — with the resource tag the envelope adds. */
const raw = (...parts: string[]): string =>
  Buffer.from(["reviews-LISTING", ...parts].join("|")).toString("base64url");

/** Untrusted input like every cursor here, so what matters is what it refuses. */
describe("review cursor", () => {
  it("carries the moment the review was written, the id, and the ordering", () => {
    for (const sort of ["newest", "oldest"] satisfies ReviewSort[]) {
      expect(
        decodeCursor(ReviewKind.LISTING, encodeCursor(review, sort)),
      ).toEqual({ sort, createdAt: new Date(review.createdAt), id: review.id });
    }
  });

  it("refuses anything it did not write", () => {
    for (const value of [
      "",
      "not-a-cursor",
      raw("byRating", review.createdAt, review.id),
      raw("newest", "yesterday", review.id),
      raw("newest", review.createdAt, "not-a-uuid"),
      raw("newest", review.createdAt),
    ]) {
      expect(decodeCursor(ReviewKind.LISTING, value)).toBeNull();
    }
  });

  /** Both lists spell a moment and a uuid; the kind in the tag is what tells them apart. */
  it("refuses a cursor of the other list of reviews", () => {
    const ofAListing = encodeCursor(review, "newest");

    expect(decodeCursor(ReviewKind.GUEST, ofAListing)).toBeNull();
  });

  it("refuses a cursor another resource of this API issued", () => {
    expect(
      decodeCursor(
        ReviewKind.LISTING,
        encodeParts("bookings", "newest", review.createdAt, review.id),
      ),
    ).toBeNull();
  });
});
