import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { useSecurityHeaders } from "../../src/common/security-headers";

/**
 * The headers come from the function main.ts calls, applied in the same order: before
 * `SwaggerModule.setup`, which mounts `/docs` on Express at once — so the spec also pins
 * that the one HTML page is not left without them.
 */
describe("Security headers (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    useSecurityHeaders(app);
    SwaggerModule.setup(
      "docs",
      app,
      SwaggerModule.createDocument(app, new DocumentBuilder().build()),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("sends Helmet's headers on a JSON answer and drops Express's banner", async () => {
    const response = await request(app.getHttpServer()).get("/").expect(200);

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["strict-transport-security"]).toContain("max-age=");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("covers /docs, registered after it, and never asks for an HTTPS upgrade", async () => {
    const response = await request(app.getHttpServer())
      .get("/docs/")
      .expect(200);
    const policy = String(response.headers["content-security-policy"]);

    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});
