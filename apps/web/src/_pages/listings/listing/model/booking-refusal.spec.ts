import { describe, expect, it } from "vitest";
import { ApiResponseError } from "#shared/api";
import { isDatesUnavailable, isListingChanged } from "./booking-refusal";

const refusal = (status: number, code: ApiResponseError["code"]) =>
  new ApiResponseError(status, "Refused", [], code);

describe("the refusals of a hold the listing page tells apart", () => {
  it("takes the nights as taken only on their own code", () => {
    expect(isDatesUnavailable(refusal(409, "DATES_UNAVAILABLE"))).toBe(true);
    // A second kind of conflict on the route must not offer the waitlist.
    expect(isDatesUnavailable(refusal(409, "BOOKING_BUSY"))).toBe(false);
    expect(isDatesUnavailable(refusal(409, "UNKNOWN_ERROR"))).toBe(false);
  });

  it("reads the listing again when its terms moved on, and not for a calendar", () => {
    expect(isListingChanged(refusal(412, "LISTING_CHANGED_SINCE_SHOWN"))).toBe(
      true,
    );
    expect(isListingChanged(refusal(409, "DATES_UNAVAILABLE"))).toBe(false);
    expect(isListingChanged(refusal(412, "UNKNOWN_ERROR"))).toBe(false);
  });
});
