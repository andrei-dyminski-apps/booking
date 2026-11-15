import type { INestApplication } from "@nestjs/common";
import helmet from "helmet";

/**
 * Helmet's headers on every answer, its defaults but one directive. Registered before
 * `SwaggerModule.setup`, which mounts `/docs` on Express at once: middleware added after it
 * never reaches the one HTML page this API serves.
 */
export function useSecurityHeaders(app: INestApplication): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // `/docs` exists only outside production, where it is plain HTTP: Safari upgrades
          // even `localhost`, and Swagger UI's scripts would then fail to load.
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
}
