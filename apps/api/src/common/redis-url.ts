/**
 * The one Redis this API talks to, read where a connection is made rather than at import
 * time. No fallback, the same rule as the JWT secrets and DATABASE_URL: a missing REDIS_URL
 * stops the process at boot. Two things connect with it — the BullMQ queue of hold expiry
 * and the pub/sub of `RealtimeService` — and both are told the same address.
 */
export function requireRedisUrl(): string {
  const url = process.env.REDIS_URL;

  if (url === undefined || url === "") {
    throw new Error("REDIS_URL is not set — copy .env.example to .env");
  }

  return url;
}
