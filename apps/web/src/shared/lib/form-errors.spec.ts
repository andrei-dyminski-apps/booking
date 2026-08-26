import { describe, expect, it } from "vitest";
import { ApiResponseError, ApiUnreachableError } from "../api/http-client";
import { toFieldErrors, toFormErrors } from "./form-errors";

describe("toFieldErrors", () => {
  it("groups messages under the first path segment", () => {
    expect(
      toFieldErrors([
        { path: ["email"], message: "Invalid email" },
        { path: ["email"], message: "Required" },
        { path: ["password"], message: "Too short" },
      ]),
    ).toEqual({
      email: ["Invalid email", "Required"],
      password: ["Too short"],
    });
  });

  it("drops an issue about the object as a whole, which has no field to sit next to", () => {
    expect(
      toFieldErrors([{ path: [], message: "Passwords must match" }]),
    ).toEqual({});
  });

  it("drops a numeric path segment, since no form field is keyed by index", () => {
    expect(toFieldErrors([{ path: [0], message: "Required" }])).toEqual({});
  });

  it("returns an empty object for no issues", () => {
    expect(toFieldErrors([])).toEqual({});
  });
});

describe("toFormErrors", () => {
  it("reads an ApiResponseError into the form message plus its field issues", () => {
    const error = new ApiResponseError(422, "Validation failed", [
      { path: ["email"], message: "Already registered" },
    ]);

    expect(toFormErrors(error)).toEqual({
      message: "Validation failed",
      fields: { email: ["Already registered"] },
    });
  });

  it("gives an ApiUnreachableError a fixed message and no fields", () => {
    expect(
      toFormErrors(new ApiUnreachableError(new Error("fetch failed"))),
    ).toEqual({
      message: "The service is unavailable. Please try again in a moment.",
      fields: {},
    });
  });

  it("rethrows anything that is not one of the transport's two errors", () => {
    const drift = new TypeError("unexpected shape");

    expect(() => toFormErrors(drift)).toThrow(drift);
  });
});
