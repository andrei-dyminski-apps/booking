import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
