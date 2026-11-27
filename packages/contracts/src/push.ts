import { z } from "zod";
import { storedTimeZoneSchema, timeZoneSchema } from "./check-in.js";
import { rule } from "./error-code.js";

/**
 * The push services the browsers hand out endpoints of: Chrome, Opera and Samsung Internet
 * (Firebase Cloud Messaging), Edge (Windows Push Notification Services), Firefox (Mozilla's
 * autopush) and Safari (Apple's). The API posts to whatever endpoint a subscription names,
 * so an address outside this list would let any account make the server send requests to
 * a host of its choosing — an internal one included.
 */
const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  return canonicalPushEndpoint(endpoint) !== null;
}

function canonicalPushEndpoint(endpoint: string): string | null {
  let url: URL;

  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }

  return url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    !endpoint.includes("#") &&
    url.href.length <= 2048 &&
    PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname))
    ? url.href
    : null;
}

const endpointSchema = z
  .string()
  .max(2048, {
    error: rule("PUSH_ENDPOINT_INVALID", "Not a push service address"),
  })
  .refine(isPushServiceEndpoint, {
    error: rule("PUSH_ENDPOINT_INVALID", "Not a push service address"),
  })
  .overwrite((endpoint) => canonicalPushEndpoint(endpoint) ?? endpoint);

const invalidKey = rule("PUSH_KEY_INVALID", "Invalid push key");
const pushAuthSecretSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{21}[AQgw]$/, { error: invalidKey });

/**
 * A browser's push subscription, as `PushSubscription.toJSON()` writes it — the
 * `expirationTime` beside it is dropped, since no browser sets it.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    // An uncompressed P-256 public key is 65 bytes and starts with 0x04.
    p256dh: z.string().regex(/^B[A-P][A-Za-z0-9_-]{84}[AEIMQUYcgkosw048]$/, {
      error: invalidKey,
    }),
    // A 16-byte authentication secret has four unused bits in its last character.
    auth: pushAuthSecretSchema,
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushRegistrationSchema = pushSubscriptionSchema.extend({
  previousEndpoint: endpointSchema.optional(),
});
export type PushRegistration = z.infer<typeof pushRegistrationSchema>;

/** A worker can only maintain the subscription whose existing secret it has. */
export const pushMaintenanceSchema = z.object({
  accountId: z.uuid(),
  endpoint: endpointSchema,
  auth: pushAuthSecretSchema,
  replacement: pushSubscriptionSchema.optional(),
});
export type PushMaintenance = z.infer<typeof pushMaintenanceSchema>;

/** Which of this account's subscriptions to forget — the browser's own. */
export const pushUnsubscribeSchema = z.object({ endpoint: endpointSchema });
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;

export const pushSubscriptionStatusSchema = z.object({
  registered: z.boolean(),
});
export type PushSubscriptionStatus = z.infer<
  typeof pushSubscriptionStatusSchema
>;

/** The key a browser subscribes with; `null` while the API has no push keys set. */
export const pushConfigSchema = z.object({ publicKey: z.string().nullable() });
export type PushConfig = z.infer<typeof pushConfigSchema>;

/**
 * What one push carries to the service worker, which shows it as a system notification:
 * `url` is a path of the site opened by a click, `tag` folds several pushes about one
 * thing into one notification — which is also what keeps a push sent twice, the price of
 * delivering at least once, one notification on the screen.
 */
export const pushPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  // A path of the site: `//host` would be read by the browser as another origin.
  url: z.string().regex(/^\/(?!\/)/),
  tag: z.string(),
  /** Message creation time in epoch milliseconds, for pushes that reach the browser out of order. */
  messageAt: z.int().nonnegative().optional(),
  /** The delivery's id, which the service worker posts back as its receipt. */
  receipt: z.uuid(),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

/** The encrypted payload identifies the browser subscription it was sent to. */
export const webPushPayloadSchema = pushPayloadSchema.extend({
  subscriptionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type WebPushPayload = z.infer<typeof webPushPayloadSchema>;

/** Bind a tab's request to the account it was rendered for when it knows that account. */
export const pushAccountQuerySchema = z.object({
  accountId: z.uuid().optional(),
});

/**
 * What an account can mute on push: the mail's groups, plus the reviews and the alerts only
 * an admin is told (a payment event the worker gave up on, a refund or a payout that failed).
 */
export const pushGroupSchema = z.enum([
  "stays",
  "payments",
  "messages",
  "reviews",
  "waitlist",
  "alerts",
]);
export type PushGroup = z.infer<typeof pushGroupSchema>;

/** `HH:mm`, on a 24-hour clock — what `<input type="time">` submits. */
const pushClockSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
  error: rule("PUSH_QUIET_HOURS_INVALID", "A time has to be written as HH:mm"),
});

/**
 * A window of the day nothing is pushed in, on the clock of `timeZone` — the zone of the
 * browser that saved it. `from` after `to` wraps past midnight (22:00–07:00); the two equal
 * would be a window of nothing or of the whole day, and is refused.
 */
export const pushQuietHoursSchema = z
  .object({
    from: pushClockSchema,
    to: pushClockSchema,
    timeZone: timeZoneSchema,
  })
  .refine(({ from, to }) => from !== to, {
    error: rule(
      "PUSH_QUIET_HOURS_INVALID",
      "Quiet hours have to start and end at different times",
    ),
    path: ["to"],
  });
export type PushQuietHours = z.infer<typeof pushQuietHoursSchema>;

/**
 * The most an account can ask to be pushed in an hour; `null` is no limit. The same bound is
 * `push_preferences_hourly_limit_within_contract` on the column: the two move together.
 */
export const MAX_PUSH_HOURLY_LIMIT = 60;

/**
 * How an account wants to be pushed to, on every browser it subscribed: the groups it muted,
 * the quiet hours a push waits out, and how many pushes an hour it takes at most — those
 * past the limit are not pushed, and stay on the bell and in the inbox.
 */
const invalidHourlyLimit = rule(
  "PUSH_HOURLY_LIMIT_INVALID",
  `A limit has to be a whole number from 1 to ${String(MAX_PUSH_HOURLY_LIMIT)}`,
);

export const pushPreferencesSchema = z.object({
  muted: z.array(pushGroupSchema).max(pushGroupSchema.options.length),
  quietHours: pushQuietHoursSchema.nullable(),
  hourlyLimit: z
    .int({ error: invalidHourlyLimit })
    .min(1, { error: invalidHourlyLimit })
    .max(MAX_PUSH_HOURLY_LIMIT, { error: invalidHourlyLimit })
    .nullable(),
});
export type PushPreferences = z.infer<typeof pushPreferencesSchema>;

/**
 * What `GET /push/settings` answers: the zone of the quiet hours as stored, unchecked against
 * the reader's `Intl` — see `storedTimeZoneSchema`. A window saved in a browser whose zone
 * data is newer than this one's still reads here.
 */
export const storedPushPreferencesSchema = pushPreferencesSchema.extend({
  quietHours: z
    .object({
      from: pushClockSchema,
      to: pushClockSchema,
      timeZone: storedTimeZoneSchema,
    })
    .nullable(),
});

export const pushPreferencesPatchSchema = pushPreferencesSchema
  .partial()
  .extend({
    groups: z.partialRecord(pushGroupSchema, z.boolean()).optional(),
  });
export type PushPreferencesPatch = z.infer<typeof pushPreferencesPatchSchema>;

export const DEFAULT_PUSH_PREFERENCES: PushPreferences = {
  muted: [],
  quietHours: null,
  hourlyLimit: null,
};

/**
 * What the service worker tells the API about one push: `received` when the push reached
 * the browser, `clicked` when its notification was opened. The id is the delivery's — a
 * random uuid only that browser was sent, so it is the whole of the credential.
 */
export const pushReceiptSchema = z.object({
  id: z.uuid(),
  event: z.enum(["received", "clicked"]),
});
export type PushReceipt = z.infer<typeof pushReceiptSchema>;
