import type { IncomingMessage } from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";

/**
 * The routes whose body is checked against a signature over its exact bytes — the two
 * Stripe webhooks. The parsed JSON cannot be turned back into those bytes.
 */
const SIGNED_BODY_PATHS: ReadonlySet<string> = new Set([
  "/payments/webhook",
  "/payouts/webhook",
]);

/**
 * Nest's own two parsers, with the raw body kept beside the parsed one for the signed routes
 * alone — rather than Nest's `rawBody: true`, which keeps a second copy of every request
 * body for the whole API. For an application created with `bodyParser: false`; `main.ts`
 * and the e2e spec that posts to the webhooks both call it.
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
