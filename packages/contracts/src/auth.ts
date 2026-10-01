import { z } from "zod";

/** Kept in sync with the `Role` enum of the Prisma schema; `RolesGuard` in `apps/api` is what enforces it. */
export const roleSchema = z.enum(["USER", "OWNER", "ADMIN"]);

/**
 * The same three names as a runtime value, so `@Roles(Role.OWNER)` reads like an enum
 * without there being a second list to keep in step — zod derives it from the schema
 * above, and the type of the same name below is derived from it too.
 */
export const Role = roleSchema.enum;

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
const emailSchema = z.email().max(254).toLowerCase();

/**
 * The lower bound is the only rule worth enforcing — a composition rule ("one digit,
 * one capital") narrows the search space instead of widening it. The upper bound guards
 * the hashing itself: argon2 has no input limit, so without it a request could ask the
 * server to hash a megabyte.
 */
const passwordSchema = z
  .string()
  .min(8, { message: "Password must be at least 8 characters long" })
  .max(128, { message: "Password may not be longer than 128 characters" });

/** What the API tells the client about the signed-in person — never the password hash. */
export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: roleSchema,
  createdAt: z.iso.datetime(),
});

export const registerSchema = z.object({
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
      message: "Passwords do not match",
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
  password: z.string().min(1, { message: "Password is required" }),
});

export type Role = z.infer<typeof roleSchema>;
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
