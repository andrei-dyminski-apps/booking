import type { IncomingMessage } from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";

/** The Stripe webhooks: their signature is over the exact bytes, which parsed JSON loses. */
const SIGNED_BODY_PATHS: ReadonlySet<string> = new Set([
  "/payments/webhook",
  "/payouts/webhook",
]);

/**
 * Nest's two parsers, keeping the raw body for the signed routes alone — `rawBody: true`
 * would keep a second copy of every body. For an app created with `bodyParser: false`.
 */
export function useBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser("json", { verify: keepSignedBody });
  app.useBodyParser("urlencoded", { extended: true });
}

function keepSignedBody(
  request: IncomingMessage & { rawBody?: Buffer },
  _response: unknown,
  body: Buffer,
): void {
  const path = (request.url ?? "").split("?")[0] ?? "";

  if (SIGNED_BODY_PATHS.has(path)) request.rawBody = body;
}
