import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // /docs describes the whole API surface, so it stays out of production.
  if (process.env.NODE_ENV !== "production") {
    // OpenAPI schemas are derived from the @repo/contracts zod schemas;
    // cleanupOpenApiDoc converts them into the shape @nestjs/swagger understands.
    const config = new DocumentBuilder()
      .setTitle("Booking API")
      .setVersion("0.0.1")
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, cleanupOpenApiDoc(document));
  }

  const origins = (
    process.env.WEB_ORIGIN ?? `http://localhost:${process.env.WEB_PORT ?? 3000}`
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  await app.listen(
    process.env.API_PORT ?? process.env.PORT ?? 3001,
    process.env.API_HOST ?? "0.0.0.0",
  );
}
void bootstrap();
