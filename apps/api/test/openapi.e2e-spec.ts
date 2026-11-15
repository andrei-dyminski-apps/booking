import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from "./../src/auth/cookies";
import { createOpenApiDocument } from "./../src/common/openapi";

type ResponseObject = {
  content?: Record<string, unknown>;
  description?: string;
};

type Parameter = {
  name: string;
  in: string;
  schema?: { format?: string };
};

type Operation = {
  summary?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: {
    content?: Record<string, { schema?: { $ref?: string } }>;
  };
  security?: Record<string, unknown>[];
  responses?: Record<string, ResponseObject>;
};

/**
 * `OpenAPIObject` types the paths as a union of fixed method keys, and these checks index
 * them by a string variable — so the generated document is read back through the narrower
 * shape the assertions actually need.
 */
type SecurityView = {
  security?: unknown[];
  tags?: { name: string }[];
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, { example?: unknown }> };
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

    // The function main.ts serves — the point is what the decorators produce through it.
    document = createOpenApiDocument(app) as unknown as SecurityView;
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
    expect(description).toContain("an admin's");
    expect(description).toContain("since the token was issued");
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

  it("names the refresh cookie on the two routes that read it, still open to the guard", () => {
    for (const path of ["/auth/refresh", "/auth/logout"]) {
      const { security } = operation(path, "post");

      expect(security).toContainEqual({});
      expect(security).toContainEqual({ [REFRESH_TOKEN_COOKIE]: [] });
    }
  });

  it("gives every route a summary and a tag the document lists", () => {
    const listed = new Set(document.tags?.map((tag) => tag.name));

    for (const [path, method, found] of routes()) {
      const route = { route: `${method} ${path}` };

      expect({
        ...route,
        summary: Boolean(found.summary),
        // One tag, and one /docs lists: a tag named only by a controller is put after the
        // listed ones and reads as a misspelling of one.
        tagged:
          found.tags?.length === 1 &&
          found.tags.every((tag) => listed.has(tag)),
      }).toEqual({ ...route, summary: true, tagged: true });
    }
  });

  it("answers the guard's 401 exactly where the document asks for the session", () => {
    const NO_SESSION = "access cookie is missing";

    for (const [path, method, found] of routes()) {
      const route = { route: `${method} ${path}` };
      const open = found.security?.some(
        (requirement) => Object.keys(requirement).length === 0,
      );

      expect({
        ...route,
        guard401:
          found.responses?.["401"]?.description?.includes(NO_SESSION) === true,
      }).toEqual({ ...route, guard401: open !== true });
    }

    // A 401 of the route's own keeps its reason first and gains the guard's after it.
    const { description } =
      operation("/bookings", "post").responses?.["401"] ?? {};

    expect(description).toMatch(
      new RegExp(
        `^The account behind the token no longer exists\n\n.*${NO_SESSION}`,
      ),
    );
  });

  it("draws a path id as a uuid where ParseUUIDPipe checks it, and only there", () => {
    const ids = routes().flatMap(([path, method, found]) =>
      (found.parameters ?? [])
        .filter((parameter) => parameter.in === "path")
        .map((parameter) => ({
          route: `${method} ${path}`,
          uuid: parameter.schema?.format === "uuid",
        })),
    );

    // A provider's id — Stripe's `evt_…` and `re_…` — is no uuid, and no pipe refuses it.
    const providerIds = new Set([
      "post /payment-events/{id}/retry",
      "post /refund-failures/{id}/resolve",
    ]);

    expect(ids).toEqual(
      ids.map(({ route }) => ({ route, uuid: !providerIds.has(route) })),
    );
  });

  it("answers the pipe's 400 on every route that takes checked input, and the limiter's 429 on all", () => {
    for (const [path, method, found] of routes()) {
      const route = { route: `${method} ${path}` };
      const parameters = found.parameters ?? [];
      const parsed =
        found.requestBody !== undefined ||
        parameters.some((parameter) => parameter.in === "query");
      const checkedId = parameters.some(
        (parameter) =>
          parameter.in === "path" && parameter.schema?.format === "uuid",
      );
      const description = found.responses?.["400"]?.description ?? "";

      // The pipe's `errors` only where a schema parses; `ParseUUIDPipe` answers a message.
      expect({
        ...route,
        validation: description.includes("failed validation"),
        notUuid: description.includes("not a UUID"),
        limited: found.responses?.["429"] !== undefined,
      }).toEqual({
        ...route,
        validation: parsed,
        notUuid: checkedId,
        limited: true,
      });
    }

    // A path id no pipe checks cannot fail validation, and the route has nothing else to.
    expect(
      operation("/payment-events/{id}/retry", "post").responses?.["400"],
    ).toBeUndefined();
  });

  it("offers an example on every request body", () => {
    // `api-example.spec.ts` parses the examples there are; this is what notices a body
    // that has none.
    for (const [path, method, found] of routes()) {
      if (found.requestBody === undefined) continue;

      const ref = found.requestBody.content?.["application/json"]?.schema?.$ref;
      const name = ref?.split("/").at(-1) ?? "";
      const route = { route: `${method} ${path}` };

      expect({
        ...route,
        example: document.components?.schemas?.[name]?.example !== undefined,
      }).toEqual({ ...route, example: true });
    }
  });
});
