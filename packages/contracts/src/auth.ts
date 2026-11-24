import { z } from "zod";
import { Role } from "./enums.js";
import { rule } from "./error-code.js";

export const roleSchema = z.enum(Role);

const emailFormat = rule("EMAIL_INVALID", "Invalid email address");
const dotAtom =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/u;
const domainLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function normalizeEmail(address: string): string | null {
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (
    at < 1 ||
    local.length > 64 ||
    !dotAtom.test(local) ||
    !/^[\p{L}\p{M}\p{N}.\-\u3002\uFF0E\uFF61]+$/u.test(domain)
  )
    return null;

  let host: string;
  try {
    host = new URL("https://" + domain).hostname;
  } catch {
    return null;
  }
  const labels = host.split(".");
  if (
    labels.length < 2 ||
    /^\d+$/.test(labels.at(-1) ?? "") ||
    !labels.every((label) => domainLabel.test(label))
  )
    return null;
  const email = local + "@" + host;
  return email.length <= 254 ? email : null;
}

const boundedEmail = z
  .string()
  .trim()
  .max(254, {
    error: rule(
      "EMAIL_TOO_LONG",
      "An email address may not be longer than 254 characters",
      { maximum: 254 },
    ),
  });

// Resend delivery uses an ASCII mailbox local part. IDNA domains use their DNS form.
export const emailSchema = boundedEmail
  .refine((address) => normalizeEmail(address) !== null, {
    error: emailFormat,
    when: ({ value }) => boundedEmail.safeParse(value).success,
  })
  .transform((address) => normalizeEmail(address) ?? address)
  .meta({ format: "email" });

// Keep previously accepted addresses usable for sign-in during the transition.
const legacyEmailSchema = z.email().max(254);
const loginEmailSchema = boundedEmail
  .refine(
    (address) =>
      normalizeEmail(address) !== null ||
      legacyEmailSchema.safeParse(address).success,
    {
      error: emailFormat,
      when: ({ value }) => boundedEmail.safeParse(value).success,
    },
  )
  .transform((address) => normalizeEmail(address) ?? address)
  .meta({ format: "email" });

const registrableEmailSchema = emailSchema.refine(
  (email) => !email.endsWith(".invalid"),
  { error: emailFormat },
);

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
  email: z.string().meta({ format: "email" }),
  role: roleSchema,
  createdAt: z.iso.datetime(),
});

export const authRequestAcceptedSchema = z.object({
  accepted: z.literal(true),
});

export const registerSchema = z.object({
  email: registrableEmailSchema,
  next: z
    .string()
    .max(2048)
    .refine((value) => !value.includes("\0"), "Invalid return path")
    .optional(),
});
export const accountTokenSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const completeRegistrationSchema = z.object({
  token: accountTokenSchema,
  name: nameSchema,
  password: passwordSchema,
});

export const registerFormSchema = completeRegistrationSchema
  .extend({ confirmPassword: z.string().optional() })
  .refine(
    (values) =>
      values.confirmPassword === undefined ||
      values.confirmPassword === values.password,
    {
      path: ["confirmPassword"],
      error: rule("PASSWORDS_DO_NOT_MATCH", "Passwords do not match"),
    },
  );

export const requestPasswordResetSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: accountTokenSchema,
  password: passwordSchema,
});
export const requestEmailChangeSchema = z.object({
  email: registrableEmailSchema,
  password: z
    .string()
    .min(1, { error: rule("PASSWORD_REQUIRED", "Password is required") }),
});
export const confirmEmailChangeSchema = z.object({ token: accountTokenSchema });

/**
 * Login repeats the shape of registration but not its rules: the password policy may
 * tighten later, and an old password that no longer passes `registerSchema` still has
 * to get its owner in. Hence a plain non-empty string here.
 */
export const loginSchema = z.object({
  email: loginEmailSchema,
  password: z
    .string()
    .min(1, { error: rule("PASSWORD_REQUIRED", "Password is required") }),
});

export type User = z.infer<typeof userSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CompleteRegistrationInput = z.infer<
  typeof completeRegistrationSchema
>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RequestEmailChangeInput = z.infer<typeof requestEmailChangeSchema>;
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
