import { z } from "zod";
import { Role } from "./enums.js";
import { rule } from "./error-code.js";

/** Built from the runtime value in `enums.ts`, so `@Roles(Role.ADMIN)` and the schema share one list. */
export const roleSchema = z.enum(Role);

/**
 * Checks run in the order they are written, so the address is validated first and
 * lower-cased afterwards: the unique index in the database compares bytes, and
 * `User@example.com` has to reach the same row as `user@example.com`. 254 is the longest
 * address a mail server has to accept (RFC 5321).
 *
 * Normalising through a `.pipe()` would also trim whitespace, but it hides the format
 * behind an unconstrained input schema — and with it the `format: email` of the OpenAPI
 * document, which is generated from this very schema.
 */
const emailFormat = rule("EMAIL_INVALID", "Invalid email address");

const emailSchema = z
  .email({
    // `error` on a schema reaches every issue it raises, a missing or non-string value
    // included, which would answer "expected string" with the code of a malformed address.
    // Only the format check is the rule's; anything else falls through to zod's own
    // sentence and `INVALID_INPUT`, as it does for the name and the password.
    error: (issue) =>
      issue.code === "invalid_format" ? emailFormat(issue) : undefined,
  })
  .max(254, {
    error: rule(
      "EMAIL_TOO_LONG",
      "An email address may not be longer than 254 characters",
      {
        maximum: 254,
      },
    ),
  })
  .toLowerCase();

/**
 * The lower bound is the only rule worth enforcing — a composition rule ("one digit,
 * one capital") narrows the search space instead of widening it. The upper bound guards
 * the hashing itself: argon2 has no input limit, so without it a request could ask the
 * server to hash a megabyte.
 */
const passwordSchema = z
  .string()
  .min(8, {
    error: rule(
      "PASSWORD_TOO_SHORT",
      "Password must be at least 8 characters long",
      { minimum: 8 },
    ),
  })
  .max(128, {
    error: rule(
      "PASSWORD_TOO_LONG",
      "Password may not be longer than 128 characters",
      { maximum: 128 },
    ),
  });

/**
 * The name a person goes by on the site — what a host reads on a stay instead of an
 * address, and what the filter boxes of the stays and the listings suggest. Free text,
 * because names do not follow a format; trimmed, because a box that held only spaces is
 * not a name, and bounded, because it is drawn on a card. It is not unique and is never a
 * key: two guests may share one, and the id behind it is what a filter carries.
 *
 * It has to hold a letter or a digit of some script. `trim` takes off the whitespace it
 * knows, and a zero-width space or a control character is not that — a name made only of
 * them passes as one and reaches every card as an empty line nobody can search for.
 */
export const nameSchema = z
  .string()
  .trim()
  // `abort`: an empty box is one mistake, and "no letter in it" would only say it twice.
  .min(1, { error: rule("NAME_REQUIRED", "Enter your name"), abort: true })
  .max(100, {
    error: rule(
      "NAME_TOO_LONG",
      "A name may not be longer than 100 characters",
      {
        maximum: 100,
      },
    ),
  })
  .regex(/[\p{L}\p{N}]/u, {
    error: rule(
      "NAME_NEEDS_LETTER",
      "A name has to have at least one letter in it",
    ),
  });

/** What the API tells the client about the signed-in person — never the password hash. */
export const userSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  role: roleSchema,
  createdAt: z.iso.datetime(),
});

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

/**
 * Registration as it is filled in, rather than as it is sent. `registerSchema` above is
 * the request body and stays it: the second box is a question about what was typed here
 * and never travels. The rule is written here anyway, because a sentence a visitor reads
 * is worded where every other one is, and because a form on this site parses against a
 * contract schema rather than against a copy assembled in a component.
 *
 * The confirmation is optional because it is only asked for while the password is behind
 * asterisks. A form that puts the characters on the screen has already answered what this
 * box asks, so it takes the box away — and its absence is how the schema reads that.
 */
export const registerFormSchema = registerSchema
  .extend({ confirmPassword: z.string().optional() })
  .refine(
    (values) =>
      values.confirmPassword === undefined ||
      values.confirmPassword === values.password,
    {
      error: rule("PASSWORDS_DO_NOT_MATCH", "Passwords do not match"),
      path: ["confirmPassword"],
    },
  );

/**
 * Login repeats the shape of registration but not its rules: the password policy may
 * tighten later, and an old password that no longer passes `registerSchema` still has
 * to get its owner in. Hence a plain non-empty string here.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, { error: rule("PASSWORD_REQUIRED", "Password is required") }),
});

export type User = z.infer<typeof userSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type RegisterFormInput = z.infer<typeof registerFormSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * The session never travels in a body, so the names of the cookies that carry it are as
 * much a part of the contract as any field: `apps/api` writes them, and `apps/web` reads
 * the access one in `proxy.ts` to decide whether a protected route is worth rendering at
 * all, and again in its transport to forward the session from a server render.
 *
 * The scopes belong to the contract as well, and the refresh one is what shapes the
 * frontend: that cookie is limited to the `/auth` path, so the browser hands it to the
 * API and never to the Next.js server. A dead session can therefore only be revived from
 * the browser — see the login page.
 */
export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";
