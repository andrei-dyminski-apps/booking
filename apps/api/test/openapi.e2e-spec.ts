import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import { ACCESS_TOKEN_COOKIE } from "./../src/auth/cookies";

type ResponseObject = {
  content?: Record<string, unknown>;
  description?: string;
};

type Operation = {
  security?: unknown[];
  responses?: Record<string, ResponseObject>;
};

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

  /** Every operation the document holds, so a new route joins these checks by existing. */
  const routes = (): [path: string, method: string, operation: Operation][] =>
    Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(
        ([method, found]): [string, string, Operation] => [path, method, found],
      ),
    );

  const successResponses = (): [
    path: string,
    method: string,
    status: string,
    response: ResponseObject,
  ][] =>
    routes().flatMap(([path, method, found]) =>
      Object.entries(found.responses ?? {})
        .filter(([status]) => status.startsWith("2"))
        .map(([status, response]): [string, string, string, ResponseObject] => [
          path,
          method,
          status,
          response,
        ]),
    );

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
      ["/listings", "post"],
      ["/listings/mine", "get"],
      ["/listings/{id}", "patch"],
      ["/listings/{id}", "delete"],
    ] as const) {
      // No `security` of its own: in OpenAPI 3 an operation that says nothing inherits the
      // root requirement, which is exactly what a route without @Public() should do.
      expect(operation(path, method).security).toBeUndefined();
    }
  });

  it("names the roles a route wants, so the document cannot disagree with RolesGuard", () => {
    // @Roles() documents itself through ApiForbiddenResponse — the 403 is in the document
    // only where the guard can actually produce one.
    for (const [path, method] of [
      ["/listings", "post"],
      ["/listings/mine", "get"],
      ["/listings/{id}", "patch"],
      ["/listings/{id}", "delete"],
      ["/bookings", "post"],
    ] as const) {
      expect(operation(path, method).responses?.["403"]).toBeDefined();
    }

    // And absent from the routes no role check stands in front of — the open ones
    // included, where there is no role to name in the first place.
    for (const [path, method] of [
      ["/listings", "get"],
      ["/listings/{id}", "get"],
      ["/listings/{id}/availability", "get"],
      ["/bookings", "get"],
      ["/bookings/{id}", "get"],
    ] as const) {
      expect(operation(path, method).responses?.["403"]).toBeUndefined();
    }
  });

  it("keeps both reasons for a 403 the guard and the service can each give", () => {
    // The two managing routes are refused by RolesGuard for the role and by the service for
    // the row, and Nest joins the descriptions of the two decorators instead of letting one
    // replace the other. Decorators apply bottom-up, so a reordering would silently drop a
    // half — this is what notices.
    for (const [path, method] of [
      ["/listings/{id}", "patch"],
      ["/listings/{id}", "delete"],
    ] as const) {
      const { description } = operation(path, method).responses?.["403"] ?? {};

      expect(description).toContain("belongs to another owner");
      expect(description).toContain("Requires the role USER or ADMIN");
    }
  });

  it("keeps the role on a route that declares a 403 of its own under a class-wide @Roles", () => {
    // A class decorator and a method decorator are not joined: the method's 403 replaces the
    // class's whole, so `PATCH /users/{id}` has to state the guard's reason itself.
    const { description } =
      operation("/users/{id}", "patch").responses?.["403"] ?? {};

    expect(description).toContain("Requires the role ADMIN");
    expect(description).toContain("the caller's own");
    expect(operation("/users", "get").responses?.["403"]).toBeDefined();
  });

  it("carries a JSON schema on every success response that has a body", () => {
    // Walked out of the document rather than listed here, and that is the whole point: a
    // route added without @ApiOkResponse/@ApiCreatedResponse gets a bare success entry from
    // Nest with no `content`, and a list repeated in this file would simply not mention it.
    for (const [path, method, status, response] of successResponses()) {
      // The one route that answers 200 with no schema, and may: it returns a bare string
      // rather than a contract type, so there is no DTO to hand to a decorator.
      if (path === "/") continue;

      const documented = { route: `${method} ${path} -> ${status}` };

      // 204 is the other legitimate shape — declared by @ApiNoContentResponse and empty by
      // definition, so content there would be the mistake.
      expect({
        ...documented,
        hasContent: response.content !== undefined,
      }).toEqual({ ...documented, hasContent: status !== "204" });
    }
  });

  it("documents exactly one success status per route", () => {
    // Two of them means a decorator disagrees with @HttpCode — which is how a route ends up
    // drawn as answering 200 while it really answers 204, and none means it is undocumented.
    const counted = new Map<string, number>();

    for (const [path, method] of successResponses()) {
      const route = `${method} ${path}`;

      counted.set(route, (counted.get(route) ?? 0) + 1);
    }

    expect(
      [...counted].filter(([, count]) => count !== 1).map(([route]) => route),
    ).toEqual([]);
    expect(counted.size).toBe(routes().length);
  });

  it("drops the requirement on the routes @Public() opens", () => {
    for (const [path, method] of [
      ["/", "get"],
      ["/auth/register", "post"],
      ["/auth/login", "post"],
      ["/auth/refresh", "post"],
      ["/auth/logout", "post"],
      // The catalogue and everything a browsing visitor reads of it.
      ["/listings", "get"],
      ["/listings/{id}", "get"],
      ["/listings/{id}/availability", "get"],
    ] as const) {
      // An empty requirement object is how OpenAPI 3 spells "no credential needed", and an
      // operation-level `security` replaces the root one rather than adding to it.
      expect(operation(path, method).security).toEqual([{}]);
    }
  });
});
