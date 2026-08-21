import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import { ACCESS_TOKEN_COOKIE } from "./../src/auth/cookies";

type Operation = { security?: unknown[] };

/**
 * `OpenAPIObject` types the paths as a union of fixed method keys, and these checks index
 * them by a string variable — so the generated document is read back through the narrower
 * shape the assertions actually need.
 */
type SecurityView = {
  security?: unknown[];
  paths: Record<string, Record<string, Operation>>;
};

/**
 * The document is the only description of the API an outside reader gets, so a route drawn
 * as open while the global guard closes it is a bug in its own right. These checks pin the
 * two together: the document has to agree with the @Public() decorators, not with a list
 * repeated here.
 */
describe("OpenAPI document (e2e)", () => {
  let app: INestApplication<App>;
  let document: SecurityView;

  const operation = (path: string, method: string): Operation => {
    const found = document.paths[path]?.[method];

    if (found === undefined) {
      throw new Error(`${method} ${path} is not in the document`);
    }

    return found;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // The same builder as main.ts — the point is what the decorators produce through it.
    const config = new DocumentBuilder()
      .addCookieAuth(
        ACCESS_TOKEN_COOKIE,
        { type: "apiKey", in: "cookie", name: ACCESS_TOKEN_COOKIE },
        ACCESS_TOKEN_COOKIE,
      )
      .addSecurityRequirements(ACCESS_TOKEN_COOKIE)
      .build();

    document = SwaggerModule.createDocument(
      app,
      config,
    ) as unknown as SecurityView;
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires the session cookie for the whole document, the way the guard is global", () => {
    expect(document.security).toEqual([{ [ACCESS_TOKEN_COOKIE]: [] }]);
  });

  it("leaves the closed routes on that document-wide requirement", () => {
    for (const [path, method] of [
      ["/auth/me", "get"],
      ["/bookings", "get"],
      ["/bookings", "post"],
      ["/bookings/{id}", "delete"],
    ] as const) {
      // No `security` of its own: in OpenAPI 3 an operation that says nothing inherits the
      // root requirement, which is exactly what a route without @Public() should do.
      expect(operation(path, method).security).toBeUndefined();
    }
  });

  it("drops the requirement on the routes @Public() opens", () => {
    for (const [path, method] of [
      ["/", "get"],
      ["/auth/register", "post"],
      ["/auth/login", "post"],
      ["/auth/refresh", "post"],
      ["/auth/logout", "post"],
    ] as const) {
      // An empty requirement object is how OpenAPI 3 spells "no credential needed", and an
      // operation-level `security` replaces the root one rather than adding to it.
      expect(operation(path, method).security).toEqual([{}]);
    }
  });
});
