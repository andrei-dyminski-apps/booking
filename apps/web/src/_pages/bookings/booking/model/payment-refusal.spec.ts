import { describe, expect, it } from "vitest";
import { ApiResponseError } from "#shared/api";
import {
  isBeingOpened,
  isHoldRefusal,
  isNoLongerWaiting,
} from "./payment-refusal";

const conflict = (code: ApiResponseError["code"]) =>
  new ApiResponseError(409, "Refused", [], code);

describe("the two reasons a payment is refused with a 409", () => {
  it("asks again only while another request is opening the payment", () => {
    expect(isBeingOpened(conflict("PAYMENT_BEING_OPENED"))).toBe(true);
    expect(isBeingOpened(conflict("BOOKING_NOT_AWAITING_PAYMENT"))).toBe(false);
  });

  it("does not ask again for a hold that moved on, and says so", () => {
    expect(isNoLongerWaiting(conflict("BOOKING_NOT_AWAITING_PAYMENT"))).toBe(
      true,
    );
    expect(isNoLongerWaiting(conflict("PAYMENT_BEING_OPENED"))).toBe(false);
  });

  it("reads the booking again after either, and after nothing else", () => {
    expect(isHoldRefusal(conflict("PAYMENT_BEING_OPENED"))).toBe(true);
    expect(isHoldRefusal(conflict("BOOKING_NOT_AWAITING_PAYMENT"))).toBe(true);
    // A provider that cannot be reached, or an answer the build does not know, is neither.
    expect(
      isHoldRefusal(
        new ApiResponseError(502, "Down", [], "PAYMENT_NOT_OPENED"),
      ),
    ).toBe(false);
    expect(isHoldRefusal(conflict("UNKNOWN_ERROR"))).toBe(false);
    expect(isHoldRefusal(null)).toBe(false);
  });
});
