import { describe, expect, it } from "vitest";
import { ApiResponseError } from "./http-client";
import { refusedWith } from "./refusal";

describe("refusedWith", () => {
  const refusal = (status: number, code: ApiResponseError["code"]) =>
    new ApiResponseError(status, "Refused", [], code);

  it("matches the code of an API refusal, whatever its status", () => {
    expect(
      refusedWith(refusal(409, "DATES_UNAVAILABLE"), "DATES_UNAVAILABLE"),
    ).toBe(true);
    expect(
      refusedWith(
        refusal(409, "PAYMENT_DISPUTED"),
        "STAY_NOT_PAID",
        "PAYMENT_DISPUTED",
      ),
    ).toBe(true);
  });

  it("does not match another reason that shares the status", () => {
    expect(
      refusedWith(refusal(409, "PAYMENT_BEING_OPENED"), "DATES_UNAVAILABLE"),
    ).toBe(false);
  });

  it("does not match an answer the contract does not know, nor anything that is no refusal", () => {
    expect(
      refusedWith(refusal(409, "UNKNOWN_ERROR"), "DATES_UNAVAILABLE"),
    ).toBe(false);
    expect(
      refusedWith(new Error("DATES_UNAVAILABLE"), "DATES_UNAVAILABLE"),
    ).toBe(false);
    expect(refusedWith(undefined, "DATES_UNAVAILABLE")).toBe(false);
  });
});
