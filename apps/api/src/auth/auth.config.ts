import type { CookieOptions } from "express";

/**
 * Injection token: the config is a plain object, so it needs an explicit provider token.
 * A symbol rather than a string — two packages cannot collide on it by accident.
 */
export const AUTH_CONFIG = Symbol("AUTH_CONFIG");

export type AuthConfig = {
  accessSecret: string;
  refreshSecret: string;
  /** Seconds. Also becomes the Max-Age of the matching cookie. */
  accessTtl: number;
  refreshTtl: number;
  cookie: Pick<CookieOptions, "httpOnly" | "secure" | "sameSite" | "domain">;
};

function required(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`${name} is not set — copy .env.example to .env`);
  }

  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw === "") return fallback;

  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer number of seconds`);
  }

  return value;
}

/**
 * There is no fallback secret on purpose: a default would ship as the production key of
 * every deployment that forgot to set the variable, and forging a token would need no
 * secret at all. Missing configuration has to stop the process at boot.
 */
export function loadAuthConfig(): AuthConfig {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    accessSecret: required("JWT_ACCESS_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),
    accessTtl: seconds("JWT_ACCESS_TTL", 15 * 60),
    refreshTtl: seconds("JWT_REFRESH_TTL", 7 * 24 * 60 * 60),
    cookie: {
      // The tokens are never handed to JavaScript: an XSS on the frontend can then make
      // requests on the user's behalf, but it cannot read the session and carry it away.
      httpOnly: true,
      secure: isProduction,
      // `lax` in both environments, because the frontend and the API are always the same
      // site: the host is `localhost` for both ports locally, and `example.com` next to
      // `api.example.com` in production. Cross-origin is not cross-site — a `lax` cookie
      // does reach a sibling subdomain — so `none` would only widen the CSRF surface that
      // `lax` closes. Putting the two on different registrable domains would force `none`
      // plus a CSRF token of our own; AUTH_COOKIE_DOMAIN exists so that never happens.
      sameSite: "lax",
      ...(process.env.AUTH_COOKIE_DOMAIN
        ? { domain: process.env.AUTH_COOKIE_DOMAIN }
        : {}),
    },
  };
}
