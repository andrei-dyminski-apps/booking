import { addDays, format, parseISO } from "date-fns";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adminRefundSchema } from "./adjustment.js";
import { loginSchema, registerFormSchema, registerSchema } from "./auth.js";
import {
  bookingQuerySchema,
  cancelBookingSchema,
  createBookingSchema,
  hostCancelBookingSchema,
} from "./booking.js";
import { startConversationSchema } from "./conversation.js";
import { endStayEarlySchema } from "./early-end.js";
import { rule, toApiIssue, toErrorCode } from "./error-code.js";
import { waiveHostFeeSchema } from "./host-fee.js";
import { lookupQuerySchema } from "./lookup.js";
import { createReviewSchema } from "./review.js";
import { userQuerySchema } from "./user.js";
import {
  RATE_UNDER_NON_REFUNDABLE_POLICY,
  availabilityQuerySchema,
  createListingSchema,
  listingQuerySchema,
  updateListingSchema,
} from "./listing.js";
import {
  failedPaymentEventQuerySchema,
  refundFailureQuerySchema,
  resolveRefundFailureSchema,
} from "./set-aside.js";

function issuesOf(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);

  if (result.success) throw new Error("The input was expected to be refused");

  return result.error.issues.map(toApiIssue);
}

describe("rule", () => {
  it("answers with the sentence and stamps the code on the finished issue", () => {
    const schema = z
      .string()
      .min(3, { error: rule("NAME_REQUIRED", "Too short", { minimum: 3 }) });

    // The stamp has to survive zod's own copy of the raw issue. If an upgrade stops
    // copying unknown keys, this is the spec that says so.
    expect(issuesOf(schema, "a")).toEqual([
      {
        path: [],
        message: "Too short",
        code: "NAME_REQUIRED",
        params: { minimum: 3 },
      },
    ]);
  });

  it("leaves params out when the rule has none", () => {
    const schema = z
      .string()
      .min(3, { error: rule("NAME_REQUIRED", "Enter a name") });

    expect(issuesOf(schema, "a")).toEqual([
      { path: [], message: "Enter a name", code: "NAME_REQUIRED" },
    ]);
  });

  it("works on a refinement, with the path of the field it names", () => {
    expect(
      issuesOf(registerFormSchema, {
        name: "Ann",
        email: "ann@example.com",
        password: "long enough",
        confirmPassword: "different",
      }),
    ).toEqual([
      {
        path: ["confirmPassword"],
        message: "Passwords do not match",
        code: "PASSWORDS_DO_NOT_MATCH",
      },
    ]);
  });
});

describe("toApiIssue", () => {
  it("gives an issue no rule claimed the code of an unnamed one, keeping zod's sentence", () => {
    expect(issuesOf(z.object({ name: z.string() }), {})).toEqual([
      {
        path: ["name"],
        message: "Invalid input: expected string, received undefined",
        code: "INVALID_INPUT",
      },
    ]);
  });

  it("names the rule of every refusal in the auth schemas", () => {
    expect(
      issuesOf(registerSchema, { name: "", email: "nope", password: "short" }),
    ).toEqual([
      { path: ["name"], message: "Enter your name", code: "NAME_REQUIRED" },
      {
        path: ["email"],
        message: "Invalid email address",
        code: "EMAIL_INVALID",
      },
      {
        path: ["password"],
        message: "Password must be at least 8 characters long",
        code: "PASSWORD_TOO_SHORT",
        params: { minimum: 8 },
      },
    ]);

    expect(issuesOf(loginSchema, { email: "a@b.co", password: "" })).toEqual([
      {
        path: ["password"],
        message: "Password is required",
        code: "PASSWORD_REQUIRED",
      },
    ]);
  });
});

describe("the email rule", () => {
  it("names the format of an address and its length, and leaves a missing value to zod", () => {
    expect(issuesOf(loginSchema, { email: "nope", password: "x" })).toEqual([
      {
        path: ["email"],
        message: "Invalid email address",
        code: "EMAIL_INVALID",
      },
    ]);

    expect(
      issuesOf(loginSchema, {
        email: `${"a".repeat(250)}@b.co`,
        password: "x",
      }),
    ).toEqual([
      {
        path: ["email"],
        message: "An email address may not be longer than 254 characters",
        code: "EMAIL_TOO_LONG",
        params: { maximum: 254 },
      },
    ]);

    // Not a malformed address: nothing was there to be malformed.
    for (const email of [undefined, 5]) {
      expect(issuesOf(loginSchema, { email, password: "x" })).toEqual([
        {
          path: ["email"],
          message: expect.stringContaining("expected string"),
          code: "INVALID_INPUT",
        },
      ]);
    }
  });
});

describe("toErrorCode", () => {
  it("passes a code the list holds", () => {
    expect(toErrorCode("PASSWORD_TOO_SHORT")).toBe("PASSWORD_TOO_SHORT");
  });

  it("reads a code this build has no word for as unknown, not as a guess", () => {
    expect(toErrorCode("A_RULE_FROM_A_NEWER_API")).toBe("UNKNOWN_ERROR");
    expect(toErrorCode("")).toBe("UNKNOWN_ERROR");
  });
});

describe("the listing rules", () => {
  const listing = {
    title: "Seaside flat",
    description: "A bright flat two minutes from the beach.",
    pricePerNightCents: 12_000,
    capacity: 2,
    nonRefundableDiscountBps: null,
    timeZone: "UTC",
    checkInTime: "15:00",
  };

  const codesOf = (schema: z.ZodType, input: unknown) =>
    issuesOf(schema, input).map(({ path, code }) => ({ path, code }));

  it("names the rule of each field a listing is refused on", () => {
    expect(
      issuesOf(createListingSchema, {
        ...listing,
        title: "ab",
        description: "short",
        capacity: 51,
        pricePerNightCents: 0,
        nonRefundableDiscountBps: 5_001,
        timeZone: "Mars/Base",
        checkInTime: "25:00",
      }),
    ).toEqual([
      {
        path: ["title"],
        message: "A title needs at least 3 characters",
        code: "TITLE_TOO_SHORT",
        params: { minimum: 3 },
      },
      {
        path: ["description"],
        message: "A description needs at least 10 characters",
        code: "DESCRIPTION_TOO_SHORT",
        params: { minimum: 10 },
      },
      {
        path: ["pricePerNightCents"],
        message: "A price per night must be more than zero",
        code: "PRICE_NOT_POSITIVE",
      },
      {
        path: ["capacity"],
        message: "A listing may not sleep more than 50 guests",
        code: "CAPACITY_TOO_LARGE",
        params: { maximum: 50 },
      },
      {
        path: ["nonRefundableDiscountBps"],
        message: "A non-refundable discount has to be between 1% and 50%",
        code: "DISCOUNT_OUT_OF_RANGE",
        params: { minimumBps: 100, maximumBps: 5_000 },
      },
      {
        path: ["timeZone"],
        message: "A time zone has to be a region such as Europe/Berlin, or UTC",
        code: "TIME_ZONE_INVALID",
      },
      {
        path: ["checkInTime"],
        message: "A check-in time has to be written as HH:mm",
        code: "CHECK_IN_TIME_INVALID",
      },
    ]);
  });

  it("tells a price left empty from one that is not a number, and a fraction of a cent from a ceiling", () => {
    const priced = (pricePerNightCents: unknown) =>
      codesOf(createListingSchema, { ...listing, pricePerNightCents });

    expect(priced(undefined)).toEqual([
      { path: ["pricePerNightCents"], code: "PRICE_REQUIRED" },
    ]);
    expect(priced("a lot")).toEqual([
      { path: ["pricePerNightCents"], code: "PRICE_NOT_A_NUMBER" },
    ]);
    expect(priced(120.5)).toEqual([
      { path: ["pricePerNightCents"], code: "PRICE_NOT_WHOLE_CENTS" },
    ]);
    expect(priced(100_000_000_000)).toEqual([
      { path: ["pricePerNightCents"], code: "PRICE_TOO_HIGH" },
    ]);
  });

  it("tells a capacity left empty from one that is not whole, and an empty box from a zone", () => {
    expect(
      codesOf(createListingSchema, { ...listing, capacity: undefined }),
    ).toEqual([{ path: ["capacity"], code: "CAPACITY_REQUIRED" }]);
    expect(codesOf(createListingSchema, { ...listing, capacity: 1.5 })).toEqual(
      [{ path: ["capacity"], code: "CAPACITY_NOT_A_WHOLE_NUMBER" }],
    );
    expect(codesOf(createListingSchema, { ...listing, capacity: 0 })).toEqual([
      { path: ["capacity"], code: "CAPACITY_TOO_SMALL" },
    ]);
    // An empty box is the length check's to refuse, and the zone lookup stays out of it.
    expect(codesOf(createListingSchema, { ...listing, timeZone: "" })).toEqual([
      { path: ["timeZone"], code: "TIME_ZONE_REQUIRED" },
    ]);
  });

  it("names the ceilings of a title and a description, and a check-in time left empty", () => {
    expect(
      issuesOf(createListingSchema, {
        ...listing,
        title: "a".repeat(101),
        description: "a".repeat(2_001),
      }).map(({ path, code, params }) => ({ path, code, params })),
    ).toEqual([
      { path: ["title"], code: "TITLE_TOO_LONG", params: { maximum: 100 } },
      {
        path: ["description"],
        code: "DESCRIPTION_TOO_LONG",
        params: { maximum: 2_000 },
      },
    ]);
    expect(
      codesOf(createListingSchema, { ...listing, checkInTime: null }),
    ).toEqual([{ path: ["checkInTime"], code: "CHECK_IN_TIME_REQUIRED" }]);
  });

  it("tells a date left empty from one that is not a day, and caps how many a listing prices", () => {
    const dated = (date: unknown) =>
      codesOf(createListingSchema, {
        ...listing,
        pricing: { weekdays: {}, dates: [{ date, priceCents: 9_000 }] },
      });

    expect(dated(undefined)).toEqual([
      { path: ["pricing", "dates", 0, "date"], code: "DATE_REQUIRED" },
    ]);
    expect(dated("")).toEqual([
      { path: ["pricing", "dates", 0, "date"], code: "DATE_REQUIRED" },
    ]);
    expect(dated("soon")).toEqual([
      { path: ["pricing", "dates", 0, "date"], code: "DATE_INVALID" },
    ]);

    // One more than the contract's ceiling of 366, each on a day of its own.
    const MAX = 366;
    const crowded = Array.from({ length: MAX + 1 }, (_, index) => ({
      date: format(addDays(parseISO("2999-01-01"), index), "yyyy-MM-dd"),
      priceCents: 9_000,
    }));

    expect(
      issuesOf(createListingSchema, {
        ...listing,
        pricing: { weekdays: {}, dates: crowded },
      }).map(({ path, code, params }) => ({ path, code, params })),
    ).toEqual([
      {
        path: ["pricing", "dates"],
        code: "DATE_PRICES_TOO_MANY",
        params: { maximum: MAX },
      },
    ]);
  });

  it("names the rules of the prices a listing sets on its own", () => {
    expect(
      issuesOf(createListingSchema, {
        ...listing,
        pricing: {
          weekdays: { Fri: 15_000 },
          dates: [
            { date: "2999-01-01", priceCents: 9_000 },
            { date: "2999-01-01", priceCents: 9_500 },
            { date: "1999-01-01", priceCents: 9_500 },
            { date: "soon", priceCents: 9_500 },
          ],
        },
      }).map(({ path, code }) => ({ path, code })),
    ).toEqual([
      { path: ["pricing", "weekdays"], code: "WEEKDAY_INVALID" },
      { path: ["pricing", "dates", 2, "date"], code: "DATE_PRICE_IN_PAST" },
      { path: ["pricing", "dates", 3, "date"], code: "DATE_INVALID" },
      { path: ["pricing", "dates"], code: "DATE_PRICE_DUPLICATED" },
    ]);

    expect(
      issuesOf(createListingSchema, {
        ...listing,
        pricing: { weekdays: { Fri: 15_000 }, dates: [] },
      })[0],
    ).toMatchObject({ code: "WEEKDAY_INVALID", params: { keys: ["Fri"] } });
  });

  it("names the rule a policy and a rate break together, on the discount", () => {
    expect(
      issuesOf(createListingSchema, {
        ...listing,
        cancellationPolicy: "NON_REFUNDABLE",
        nonRefundableDiscountBps: 1_000,
      }),
    ).toEqual([
      {
        path: ["nonRefundableDiscountBps"],
        message: RATE_UNDER_NON_REFUNDABLE_POLICY,
        code: "RATE_UNDER_NON_REFUNDABLE_POLICY",
      },
    ]);
  });

  it("refuses an empty update in its own code", () => {
    expect(issuesOf(updateListingSchema, {})).toEqual([
      {
        path: [],
        message: "At least one field must be provided",
        code: "NO_FIELDS_PROVIDED",
      },
    ]);
  });

  it("names the rules of the catalogue query that span fields", () => {
    expect(codesOf(listingQuerySchema, { from: "2030-01-01" })).toEqual([
      { path: ["to"], code: "SEARCH_DATES_INCOMPLETE" },
    ]);
    expect(
      codesOf(listingQuerySchema, { from: "2030-01-05", to: "2030-01-01" }),
    ).toEqual([{ path: ["to"], code: "CHECK_OUT_NOT_AFTER_CHECK_IN" }]);
    expect(
      codesOf(listingQuerySchema, {
        minPriceCents: "9000",
        maxPriceCents: "5000",
      }),
    ).toEqual([{ path: ["maxPriceCents"], code: "PRICE_RANGE_INVERTED" }]);
  });

  it("names a day a search or a window could not read as the stay and the date price do", () => {
    // The rules that compare the two days still run on a day nobody could read, so the
    // check is that the unreadable one is named, not that it is the only issue.
    expect(
      codesOf(listingQuerySchema, { from: "soon", to: "2030-01-05" }),
    ).toContainEqual({ path: ["from"], code: "DATE_INVALID" });
    expect(
      codesOf(listingQuerySchema, { from: "2030-01-01", to: "soon" }),
    ).toEqual([{ path: ["to"], code: "DATE_INVALID" }]);
    expect(
      codesOf(availabilityQuerySchema, { from: "2030-01-01" }),
    ).toContainEqual({ path: ["to"], code: "DATE_REQUIRED" });
    expect(
      codesOf(availabilityQuerySchema, {
        from: "01/01/2030",
        to: "2030-01-05",
      }),
    ).toContainEqual({ path: ["from"], code: "DATE_INVALID" });
  });

  it("names the rules of an availability window", () => {
    expect(
      codesOf(availabilityQuerySchema, {
        from: "2030-01-05",
        to: "2030-01-05",
      }),
    ).toEqual([{ path: ["to"], code: "WINDOW_END_NOT_AFTER_START" }]);
    expect(
      issuesOf(availabilityQuerySchema, {
        from: "2030-01-01",
        to: "2032-01-01",
      }),
    ).toEqual([
      {
        path: ["to"],
        message: "The window may not be wider than 366 nights",
        code: "WINDOW_TOO_WIDE",
        params: { maximum: 366 },
      },
    ]);
  });
});

describe("the booking rules", () => {
  const LISTING_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
  const tomorrow = format(addDays(new Date(), 30), "yyyy-MM-dd");
  const later = format(addDays(new Date(), 33), "yyyy-MM-dd");
  const stay = { listingId: LISTING_ID, from: tomorrow, to: later };

  const codesOf = (schema: z.ZodType, input: unknown) =>
    issuesOf(schema, input).map(({ path, code }) => ({ path, code }));

  it("names the rule of a stay's days", () => {
    expect(
      codesOf(createBookingSchema, { ...stay, from: later, to: tomorrow }),
    ).toEqual([{ path: ["to"], code: "CHECK_OUT_NOT_AFTER_CHECK_IN" }]);
    expect(
      codesOf(createBookingSchema, { ...stay, from: "2020-01-01" }),
    ).toEqual([{ path: ["from"], code: "CHECK_IN_DAY_PAST" }]);
    expect(
      codesOf(createBookingSchema, { ...stay, from: "", to: undefined }),
    ).toEqual([
      { path: ["from"], code: "DATE_REQUIRED" },
      { path: ["to"], code: "DATE_REQUIRED" },
    ]);
    expect(codesOf(createBookingSchema, { ...stay, to: "soon" })).toEqual([
      { path: ["to"], code: "DATE_INVALID" },
    ]);
  });

  it("names the rule of a cancellation's reason", () => {
    expect(
      issuesOf(hostCancelBookingSchema, { reason: " " }).map(
        ({ code }) => code,
      ),
    ).toEqual(["CANCELLATION_REASON_REQUIRED"]);
    expect(
      issuesOf(cancelBookingSchema, { reason: "a".repeat(501) }),
    ).toMatchObject([
      { code: "CANCELLATION_REASON_TOO_LONG", params: { maximum: 500 } },
    ]);
  });

  it("names the rule of the window and the dates of a list of stays", () => {
    expect(codesOf(bookingQuerySchema, { from: tomorrow })).toEqual([
      { path: ["to"], code: "SEARCH_DATES_INCOMPLETE" },
    ]);
    expect(codesOf(bookingQuerySchema, { from: later, to: tomorrow })).toEqual([
      { path: ["to"], code: "WINDOW_END_NOT_AFTER_START" },
    ]);
  });

  it("names the rule of an admin's refund", () => {
    const refund = {
      amountCents: 500,
      reason: "Goodwill",
      requestId: "0b7e8f9a-1c2d-4e3f-8a4b-5c6d7e8f9a0b",
    };

    expect(codesOf(adminRefundSchema, { ...refund, amountCents: 0 })).toEqual([
      { path: ["amountCents"], code: "REFUND_AMOUNT_INVALID" },
    ]);
    // Whatever is no whole positive amount is one refusal, not zod's own beside it.
    for (const amountCents of [-5, 1.5, undefined, "ten"]) {
      expect(codesOf(adminRefundSchema, { ...refund, amountCents })).toEqual([
        { path: ["amountCents"], code: "REFUND_AMOUNT_INVALID" },
      ]);
    }
    expect(codesOf(adminRefundSchema, { ...refund, reason: " " })).toEqual([
      { path: ["reason"], code: "REFUND_REASON_REQUIRED" },
    ]);
    expect(
      issuesOf(adminRefundSchema, { ...refund, reason: "a".repeat(501) }),
    ).toMatchObject([
      { code: "REFUND_REASON_TOO_LONG", params: { maximum: 500 } },
    ]);
  });

  it("names the rule of the check-out an early end is stated for", () => {
    expect(
      codesOf(endStayEarlySchema, { checkOut: undefined, refundCents: 0 }),
    ).toEqual([{ path: ["checkOut"], code: "DATE_REQUIRED" }]);
    expect(
      codesOf(endStayEarlySchema, { checkOut: "tonight", refundCents: 0 }),
    ).toEqual([{ path: ["checkOut"], code: "DATE_INVALID" }]);
  });
});

describe("the set-aside and host-fee rules", () => {
  const codesOf = (schema: z.ZodType, input: unknown) =>
    issuesOf(schema, input).map(({ path, code }) => ({ path, code }));

  it("names the rule of a window over what was set aside", () => {
    expect(
      codesOf(failedPaymentEventQuerySchema, {
        from: "2026-02-02",
        to: "2026-02-01",
      }),
    ).toEqual([{ path: ["to"], code: "WINDOW_END_BEFORE_START" }]);
    // Either end alone is a whole question, and a day is a day.
    expect(
      codesOf(refundFailureQuerySchema, {
        from: "yesterday",
        to: "2026-02-01",
      }),
    ).toEqual([{ path: ["from"], code: "DATE_INVALID" }]);
  });

  it("names a day nothing sent, and the ids and type of whitespace alone", () => {
    // `blank` turns an empty string into an absence, so only whitespace reaches `min(1)`.
    expect(
      codesOf(failedPaymentEventQuerySchema, { eventId: " ", type: " " }),
    ).toEqual([
      { path: ["eventId"], code: "PROVIDER_ID_REQUIRED" },
      { path: ["type"], code: "EVENT_TYPE_REQUIRED" },
    ]);
    expect(codesOf(refundFailureQuerySchema, { refundId: "\t" })).toEqual([
      { path: ["refundId"], code: "PROVIDER_ID_REQUIRED" },
    ]);
    // A value that is no text at all (a repeated parameter) is a day nobody wrote.
    expect(
      codesOf(refundFailureQuerySchema, { from: ["2026-02-01", "2026-02-02"] }),
    ).toEqual([{ path: ["from"], code: "DATE_REQUIRED" }]);
    expect(
      codesOf(failedPaymentEventQuerySchema, { to: ["2026-02-01"] }),
    ).toEqual([{ path: ["to"], code: "DATE_REQUIRED" }]);
  });

  it("names the rule of a provider id and an event type", () => {
    expect(
      issuesOf(failedPaymentEventQuerySchema, { eventId: "e".repeat(256) }),
    ).toMatchObject([
      {
        path: ["eventId"],
        code: "PROVIDER_ID_TOO_LONG",
        params: { maximum: 255 },
      },
    ]);
    expect(
      issuesOf(refundFailureQuerySchema, { paymentId: "p".repeat(256) }),
    ).toMatchObject([{ path: ["paymentId"], code: "PROVIDER_ID_TOO_LONG" }]);
    expect(
      issuesOf(failedPaymentEventQuerySchema, { type: "t".repeat(101) }),
    ).toMatchObject([
      { path: ["type"], code: "EVENT_TYPE_TOO_LONG", params: { maximum: 100 } },
    ]);
  });

  it("names the rule of a resolution and of a waiver's reason", () => {
    expect(codesOf(resolveRefundFailureSchema, { resolution: " " })).toEqual([
      { path: ["resolution"], code: "RESOLUTION_REQUIRED" },
    ]);
    expect(
      issuesOf(resolveRefundFailureSchema, { resolution: "a".repeat(501) }),
    ).toMatchObject([
      { code: "RESOLUTION_TOO_LONG", params: { maximum: 500 } },
    ]);
    expect(codesOf(waiveHostFeeSchema, { reason: " " })).toEqual([
      { path: ["reason"], code: "WAIVE_REASON_REQUIRED" },
    ]);
    expect(
      issuesOf(waiveHostFeeSchema, { reason: "a".repeat(501) }),
    ).toMatchObject([
      { code: "WAIVE_REASON_TOO_LONG", params: { maximum: 500 } },
    ]);
  });
});

describe("the review rules", () => {
  const input = { rating: 5, comment: "Quiet, warm and exactly as described." };

  it("names a rating nobody sent, one that is no number, no whole star or out of range", () => {
    expect(
      issuesOf(createReviewSchema, { comment: input.comment }),
    ).toMatchObject([{ path: ["rating"], code: "RATING_REQUIRED" }]);
    expect(
      issuesOf(createReviewSchema, { ...input, rating: "five" }),
    ).toMatchObject([{ path: ["rating"], code: "RATING_NOT_A_NUMBER" }]);
    expect(
      issuesOf(createReviewSchema, { ...input, rating: 4.5 }),
    ).toMatchObject([{ path: ["rating"], code: "RATING_NOT_WHOLE" }]);
    expect(issuesOf(createReviewSchema, { ...input, rating: 0 })).toMatchObject(
      [{ path: ["rating"], code: "RATING_TOO_LOW", params: { minimum: 1 } }],
    );
    expect(issuesOf(createReviewSchema, { ...input, rating: 6 })).toMatchObject(
      [{ path: ["rating"], code: "RATING_TOO_HIGH", params: { maximum: 5 } }],
    );
  });

  it("names the length of a comment", () => {
    expect(
      issuesOf(createReviewSchema, { ...input, comment: " too short " }),
    ).toMatchObject([
      {
        path: ["comment"],
        code: "REVIEW_COMMENT_TOO_SHORT",
        params: { minimum: 10 },
      },
    ]);
    expect(
      issuesOf(createReviewSchema, { ...input, comment: "a".repeat(1001) }),
    ).toMatchObject([
      {
        path: ["comment"],
        code: "REVIEW_COMMENT_TOO_LONG",
        params: { maximum: 1000 },
      },
    ]);
  });
});

describe("the conversation rules", () => {
  const listingId = "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";

  it("names an empty message and one past the limit", () => {
    expect(
      issuesOf(startConversationSchema, { listingId, body: "  " }),
    ).toMatchObject([{ path: ["body"], code: "MESSAGE_REQUIRED" }]);
    expect(
      issuesOf(startConversationSchema, { listingId, body: "a".repeat(2001) }),
    ).toMatchObject([
      { path: ["body"], code: "MESSAGE_TOO_LONG", params: { maximum: 2000 } },
    ]);
  });

  it("names a listing nobody chose apart from an id that is not one", () => {
    expect(
      issuesOf(startConversationSchema, { listingId: "nothing", body: "Hi" }),
    ).toMatchObject([{ path: ["listingId"], code: "LISTING_ID_INVALID" }]);
    expect(
      issuesOf(startConversationSchema, { listingId: 7, body: "Hi" }),
    ).toMatchObject([{ path: ["listingId"], code: "LISTING_ID_INVALID" }]);
    expect(issuesOf(startConversationSchema, { body: "Hi" })).toMatchObject([
      { path: ["listingId"], code: "LISTING_REQUIRED" },
    ]);
  });
});

describe("the lookup and user filter rules", () => {
  it("names a search too short or too long for a lookup", () => {
    expect(issuesOf(lookupQuerySchema, { q: " e2 " })).toMatchObject([
      { path: ["q"], code: "LOOKUP_TOO_SHORT", params: { minimum: 3 } },
    ]);
    expect(issuesOf(lookupQuerySchema, { q: "e".repeat(255) })).toMatchObject([
      { path: ["q"], code: "LOOKUP_TOO_LONG", params: { maximum: 254 } },
    ]);
  });

  it("names the filters of the users' list", () => {
    expect(
      issuesOf(userQuerySchema, { name: " ", email: " " }).map(
        ({ path, code }) => ({ path, code }),
      ),
    ).toEqual([
      { path: ["name"], code: "NAME_FILTER_REQUIRED" },
      { path: ["email"], code: "EMAIL_FILTER_REQUIRED" },
    ]);
    expect(
      issuesOf(userQuerySchema, {
        name: "n".repeat(101),
        email: "e".repeat(255),
      }),
    ).toMatchObject([
      {
        path: ["name"],
        code: "NAME_FILTER_TOO_LONG",
        params: { maximum: 100 },
      },
      {
        path: ["email"],
        code: "EMAIL_FILTER_TOO_LONG",
        params: { maximum: 254 },
      },
    ]);
  });
});
