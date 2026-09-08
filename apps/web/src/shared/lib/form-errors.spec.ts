import { describe, expect, it } from "vitest";
import { ApiResponseError, ApiUnreachableError } from "../api/http-client";
import { messagesOf, toFieldErrors, toFormErrors } from "./form-errors";

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

describe("messagesOf", () => {
  it("has nothing to say about a field with nothing wrong with it", () => {
    expect(messagesOf(undefined)).toBeUndefined();
  });

  it("reads the one message a field with a single refusal carries", () => {
    expect(messagesOf({ type: "too_small", message: "Too short" })).toEqual([
      "Too short",
    ]);
  });

  it("prefers every message of `types` over the one `message` repeats", () => {
    expect(
      messagesOf({
        type: "too_small",
        message: "Too short",
        types: { too_small: "Too short", invalid_format: "Not an email" },
      }),
    ).toEqual(["Too short", "Not an email"]);
  });

  it("flattens a `types` entry that carries several messages of its own", () => {
    expect(
      messagesOf({
        type: "server",
        message: "Already registered",
        types: { "server-0": ["Already registered", "Try another"] },
      }),
    ).toEqual(["Already registered", "Try another"]);
  });

  it("falls back to `message` when a rule recorded itself in `types` without one", () => {
    expect(
      messagesOf({
        type: "required",
        message: "Required",
        types: { required: true },
      }),
    ).toEqual(["Required"]);
  });

  it("says nothing rather than an empty message for a refusal with no words at all", () => {
    expect(messagesOf({ type: "required", message: "" })).toBeUndefined();
    expect(messagesOf({ type: "required" })).toBeUndefined();
  });
});
