import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loginSchema, registerFormSchema, registerSchema } from "./auth.js";
import { rule, toApiIssue, toErrorCode } from "./error-code.js";

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
