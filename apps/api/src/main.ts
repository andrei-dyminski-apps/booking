import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { useBodyParsers } from "./common/body-parsers";
import { assertConnectionUrlsMatchCompose } from "./common/env-consistency";
import { createOpenApiDocument } from "./common/openapi";
import { useSecurityHeaders } from "./common/security-headers";

async function bootstrap() {
  // Before Nest, and deliberately: creating the module connects Prisma, so a URL that
  // disagrees with the containers would otherwise be reported as a refused connection
  // rather than as the two lines of .env that stopped matching.
  assertConnectionUrlsMatchCompose();

  // The parsers are registered by hand so that only the signed webhooks keep their raw
  // bytes — see `useBodyParsers`.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  useBodyParsers(app);
  useSecurityHeaders(app);

  // Behind a proxy every request arrives from the proxy's address, and the rate limiter
  // would then put all clients in one bucket — one attacker locking everyone else out.
  //
  // The value is how many X-Forwarded-For entries to believe, and Express counts them from
  // the right: it is the number of proxies that APPEND to the header, not the number of
  // hops. The frontend's BFF is not one of them — it forwards the header untouched — so
  // what it changes is the entry the proxy in front of this service appends for the
  // frontend server. 0 means believe nothing and use the socket address.
  //
  // It must not be set higher than the truth. One entry too many and req.ip stops being
  // the client address and becomes a header the client writes.
  const trustedProxies = Number(process.env.TRUST_PROXY ?? 0);

  if (Number.isInteger(trustedProxies) && trustedProxies > 0) {
    app.set("trust proxy", trustedProxies);
  }

  // /docs describes the whole API surface, so it stays out of production.
  if (process.env.NODE_ENV !== "production") {
    SwaggerModule.setup("docs", app, createOpenApiDocument(app));
  }

  const origins = (
    process.env.WEB_ORIGIN ?? `http://localhost:${process.env.WEB_PORT ?? 3000}`
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  // SIGTERM is how a container is asked to stop, and without this Nest never hears it: the
  // process would exit with the BullMQ worker mid-job and its Redis connection open. The
  // job it was running is idempotent, so what this buys is a clean close rather than
  // correctness — the worker stops taking new jobs and finishes the one it holds.
  app.enableShutdownHooks();

  await app.listen(
    process.env.API_PORT ?? process.env.PORT ?? 3001,
    process.env.API_HOST ?? "0.0.0.0",
  );
}
void bootstrap();
