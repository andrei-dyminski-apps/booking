import { describe, expect, it } from "vitest";
import { ApiResponseError } from "#shared/api";
import { mayHaveReleasedClaim } from "./refund-claim";

const refusal = (code: ApiResponseError["code"]) =>
  new ApiResponseError(409, "Refused", [], code);

describe("which refusals of an admin's refund may have let a claim go", () => {
  it.each([
    "REFUND_EXCEEDS_PAYMENT",
    "REFUND_EXCEEDS_REMAINING",
    "REFUND_REFUSED_BY_PROVIDER",
    "NOTHING_LEFT_TO_REFUND",
    "PAYMENT_DISPUTED",
    "STAY_NOT_PAID",
  ] as const)("redraws the list after %s", (code) => {
    expect(mayHaveReleasedClaim(refusal(code))).toBe(true);
  });

  it.each([
    "BOOKING_BUSY",
    "REFUND_CLAIM_PENDING",
    "REFUND_REQUEST_AMOUNT_MISMATCH",
    "REFUND_NOT_SENT",
    "UNKNOWN_ERROR",
  ] as const)("leaves the list as it was after %s", (code) => {
    expect(mayHaveReleasedClaim(refusal(code))).toBe(false);
  });
});
