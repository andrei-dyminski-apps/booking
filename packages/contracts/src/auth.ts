import { z } from "zod";

/** Kept in sync with the `Role` enum of the Prisma schema; the checks themselves arrive in phase 3. */
export const roleSchema = z.enum(["USER", "OWNER", "ADMIN"]);

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
  .max(128);

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
export type LoginInput = z.infer<typeof loginSchema>;
