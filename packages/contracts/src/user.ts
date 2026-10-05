import { z } from "zod";
import { roleSchema, userSchema } from "./auth.js";
import { blank, PAGING } from "./query.js";

/**
 * A user as an admin manages them: the session's own shape plus the one column only the
 * people who manage accounts are shown. `userSchema` stays what `/auth/me` answers — a
 * blocked user never has a session to read it with, so `blockedAt` would always be `null`
 * there and is left out rather than carried for nothing.
 *
 * `blockedAt` is a moment rather than a flag because when an account was shut is what the
 * person reopening it asks first.
 */
export const managedUserSchema = userSchema.extend({
  blockedAt: z.iso.datetime().nullable(),
});

export const managedUserListSchema = z.array(managedUserSchema);

/**
 * Whether an account may sign in, as a filter. It is derived from `blockedAt` rather than
 * stored beside it, so the two cannot disagree; the names are the filter's own because "a
 * user whose `blockedAt` is not null" is not something anybody types into a box.
 */
export const userStatusSchema = z.enum(["ACTIVE", "BLOCKED"]);

export const UserStatus = userStatusSchema.enum;

/**
 * Two orderings over the one column every account has. An ordering by address was left
 * out on purpose: the `email` filter below already finds one account by name, and a third
 * key would be a third index for a list an admin reads by recency.
 */
export const userSortSchema = z.enum(["newest", "oldest"]);

/**
 * The query of `GET /users`, as it arrives in the URL — the shape `bookingQuerySchema`
 * has, over accounts.
 *
 * `email` is a part of an address rather than a whole one, matched without regard to
 * case: an admin looking for somebody types what they remember of it. It is trimmed and
 * lower-cased the way a registration is, because that is how every stored address was
 * written, and a box holding nothing but spaces is refused rather than read as "any" — a
 * filter that looks set and matches everything is the one a person cannot see through.
 */
export const userQuerySchema = z.object({
  role: blank(roleSchema.optional()),
  status: blank(userStatusSchema.optional()),
  email: blank(
    z
      .string()
      .trim()
      .min(1, { message: "Type at least one character of the address" })
      .max(254, { message: "An address is never longer than 254 characters" })
      .toLowerCase()
      .optional(),
  ),
  sort: blank(userSortSchema.default("newest")),
  ...PAGING,
});

/**
 * One page of accounts. Paged for the reason the stays are: this is the one list on the
 * site with every visitor who ever registered in it, and nothing about it stays small.
 */
export const userPageSchema = z.object({
  items: managedUserListSchema,
  nextCursor: z.string().nullable(),
});

/**
 * What an admin may change about an account: which role it has, and whether it may sign in
 * at all. Both are optional because either is a change of its own, and at least one has to
 * be there — an empty `PATCH` would answer `200` for having done nothing.
 *
 * `blocked` is a boolean rather than a moment: when it happened is the server's clock to
 * read, not the client's to claim. Blocking also ends every session the account holds —
 * that half is the API's, and nothing a client sends can skip it.
 *
 * The email and the password are not here. An admin who could rewrite an address could
 * take an account over by resetting it to their own; a password is its owner's alone.
 */
export const updateUserSchema = z
  .object({
    role: roleSchema.optional(),
    blocked: z.boolean().optional(),
  })
  .refine((input) => input.role !== undefined || input.blocked !== undefined, {
    message: "Change the role, the block, or both",
  });

export type ManagedUser = z.infer<typeof managedUserSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type UserSort = z.infer<typeof userSortSchema>;
export type UserQuery = z.infer<typeof userQuerySchema>;
export type UserPage = z.infer<typeof userPageSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
