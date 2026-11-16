import { ParseUUIDPipe, type INestApplication } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { ModulesContainer } from "@nestjs/core";
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from "@nestjs/swagger";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "../auth/cookies";

// The package exports the document's type and not its parts, so they are read off it.
type OperationObject = NonNullable<OpenAPIObject["paths"][string]["get"]>;
type ResponseObject = Extract<
  OperationObject["responses"][string],
  { description: string }
>;
type ParameterObject = Extract<
  NonNullable<OperationObject["parameters"]>[number],
  { in: string }
>;

const DESCRIPTION = `
The HTTP API behind the booking site. Request and response bodies are the zod schemas of
\`@repo/contracts\`, the same ones the API validates with, so this page cannot drift from
what the routes accept.

**Session.** Two httpOnly cookies, never a body or a header: \`${ACCESS_TOKEN_COOKIE}\`
(short-lived, sent to every route) and \`${REFRESH_TOKEN_COOKIE}\` (scoped to \`/auth\`,
rotated by \`POST /auth/refresh\`). Log in through \`POST /auth/login\` from this page and
"Try it out" carries them. Pasting a value into "Authorize" does not work: a browser
never lets a page set the \`Cookie\` header.
Every route needs the session unless it says otherwise.

**Roles.** \`USER\` books and hosts, \`ADMIN\` moderates. A route closed to a role says
so in its \`403\`.

**Errors.** Every non-2xx answer is \`ApiErrorDto\`: \`statusCode\`, \`message\`, a stable
\`code\` naming the rule that refused (the sentence may be reworded, the code is not), and for
a body or a query that failed validation \`errors\`, one entry per field with its \`path\`,
\`code\` and, where the rule has numbers to state, \`params\`.

**Lists.** Paged by an opaque \`cursor\` taken from the previous page's \`nextCursor\`, up
to \`limit\` rows. A cursor belongs to the list and the ordering that issued it.

**Money** is a whole number of cents (\`*Cents\`) in the booking's \`currency\`; **days**
are \`YYYY-MM-DD\` and **moments** ISO 8601 in UTC.

**Rate limits** are per client address and per route, 120 requests a minute by default;
a \`429\` carries \`Retry-After\`.
`.trim();

/**
 * Tags in the order /docs lists them, so a reader meets the catalogue and a stay before the
 * admin's lists of what was set aside. A controller names its own with `@ApiTags`.
 */
const TAGS: [name: string, description: string][] = [
  ["Auth", "Registration, the session cookies and the signed-in account"],
  ["Listings", "The catalogue, a listing's calendar and a host's own listings"],
  ["Bookings", "Holding, paying for, cancelling and ending a stay"],
  ["Reviews", "What guests say about a stay and hosts about a guest"],
  ["Waitlist", "Asking to be told when booked dates come free"],
  ["Conversations", "Messages between a guest and a host"],
  ["Notifications", "The bell: notices about an account's stays and money"],
  ["Events", "The live stream that tells a browser something changed"],
  ["Payouts", "A host's Stripe account, where their share is sent"],
  ["Host fees", "What a host owes for cancelling a paid stay"],
  ["Users", "Admin: the accounts, and blocking one"],
  ["Lookups", "Admin: the people and listings a filter can be narrowed to"],
  ["Refund failures", "Admin: refunds a guest's bank sent back"],
  ["Payment events", "Admin: provider events the inbox set aside"],
  ["Status", "Whether the API answers, and reaches what it needs"],
];

const ERROR_CONTENT = {
  "application/json": { schema: { $ref: "#/components/schemas/ApiErrorDto" } },
};

const VALIDATION_FAILED =
  "The request failed validation: `errors` names each field and what is wrong with it";

const NOT_A_UUID =
  "A path id is not a UUID: `message` says so, with no `errors`";

const NO_SESSION =
  "No session: the access cookie is missing, expired or revoked — `POST /auth/refresh` issues a new one";

const RATE_LIMITED: ResponseObject = {
  description:
    "Over this route's rate limit for the caller's address; `Retry-After` is the wait in seconds",
  headers: {
    "Retry-After": { schema: { type: "integer" } },
  },
  content: ERROR_CONTENT,
};

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

/** An empty requirement object is how `@Public()` spells "no credential needed". */
const isPublic = (operation: OperationObject): boolean =>
  operation.security?.some(
    (requirement) => Object.keys(requirement).length === 0,
  ) ?? false;

/**
 * Puts a response every route shares onto one operation. A route that declares the same
 * status for a reason of its own keeps that reason first and gains the shared one after it,
 * joined the way Nest joins two decorators on one method.
 */
function addShared(
  operation: OperationObject,
  status: string,
  description: string,
): void {
  const own = operation.responses[status];

  operation.responses[status] =
    own !== undefined && "description" in own
      ? { ...own, description: `${own.description}\n\n${description}` }
      : { description, content: ERROR_CONTENT };
}

/** The key `@nestjs/swagger` gives an operation unless told otherwise, stated here. */
const operationId = (controllerKey: string, methodKey: string): string =>
  `${controllerKey}_${methodKey}`;

type RouteArgument = { data?: unknown; pipes?: unknown[] };

/**
 * The path parameters `ParseUUIDPipe` checks, by operation id. The document cannot tell:
 * a pipe is invisible to `@nestjs/swagger`, so it draws such an id as a bare string. Read
 * off the route-argument metadata `@Param("id", ParseUUIDPipe)` writes, so a route that
 * takes another kind of id — a provider's `evt_…` or `re_…` — is not one of them.
 */
function uuidPathParameters(app: INestApplication): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();

  for (const module of app.get(ModulesContainer).values()) {
    for (const { metatype } of module.controllers.values()) {
      if (typeof metatype !== "function") continue;

      const prototype: object = metatype.prototype as object;

      for (const methodKey of Object.getOwnPropertyNames(prototype)) {
        const args = Reflect.getMetadata(
          ROUTE_ARGS_METADATA,
          metatype,
          methodKey,
        ) as Record<string, RouteArgument> | undefined;

        for (const [key, { data, pipes = [] }] of Object.entries(args ?? {})) {
          if (
            !key.startsWith(`${RouteParamtypes.PARAM}:`) ||
            typeof data !== "string" ||
            !pipes.some(
              (pipe) => pipe === ParseUUIDPipe || pipe instanceof ParseUUIDPipe,
            )
          ) {
            continue;
          }

          const id = operationId(metatype.name, methodKey);

          found.set(id, (found.get(id) ?? new Set()).add(data));
        }
      }
    }
  }

  return found;
}

/**
 * The answers no decorator states because no handler throws them: the global pipe's `400`,
 * the global guard's `401` and the limiter's `429`. They are added to the finished document
 * rather than through `addGlobalResponse`, which would hand the guard's `401` to the open
 * routes too, and which keeps its responses in a process-wide store — a second document
 * built in the same process would be handed them twice.
 */
function addSharedResponses(
  document: OpenAPIObject,
  uuidParameters: Map<string, Set<string>>,
): OpenAPIObject {
  for (const methods of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = methods[method];

      if (operation === undefined) continue;

      const uuids = uuidParameters.get(operation.operationId ?? "");
      let parsed = operation.requestBody !== undefined;
      let checkedId = false;

      for (const parameter of operation.parameters ?? []) {
        if (!("in" in parameter)) continue;

        if (parameter.in === "query") parsed = true;

        if (parameter.in === "path" && uuids?.has(parameter.name) === true) {
          markUuid(parameter);
          checkedId = true;
        }
      }

      // The query and the body by the contract, with `errors`; a path id by `ParseUUIDPipe`,
      // with a message alone. A path parameter no pipe checks cannot be refused for its shape.
      if (parsed) addShared(operation, "400", VALIDATION_FAILED);
      if (checkedId) addShared(operation, "400", NOT_A_UUID);

      if (!isPublic(operation)) addShared(operation, "401", NO_SESSION);

      operation.responses["429"] = RATE_LIMITED;
    }
  }

  return document;
}

function markUuid(parameter: ParameterObject): void {
  const { schema } = parameter;

  if (schema === undefined || "$ref" in schema) return;

  parameter.schema = { ...schema, format: "uuid" };
}

/**
 * The document `/docs` serves, built here so that `main.ts` and the spec that checks it
 * describe one document rather than two builders kept alike by hand.
 */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle("Booking API")
    .setDescription(DESCRIPTION)
    .setVersion("0.0.1")
    // The requirement is document-wide because the guard is: every route is protected until
    // @Public() opens it, and that decorator is what drops the requirement again.
    .addCookieAuth(
      ACCESS_TOKEN_COOKIE,
      { type: "apiKey", in: "cookie", name: ACCESS_TOKEN_COOKIE },
      ACCESS_TOKEN_COOKIE,
    )
    .addCookieAuth(
      REFRESH_TOKEN_COOKIE,
      {
        type: "apiKey",
        in: "cookie",
        name: REFRESH_TOKEN_COOKIE,
        description:
          "Read only by `POST /auth/refresh` and `POST /auth/logout`",
      },
      REFRESH_TOKEN_COOKIE,
    )
    .addSecurityRequirements(ACCESS_TOKEN_COOKIE);

  for (const [name, description] of TAGS) builder.addTag(name, description);

  return addSharedResponses(
    cleanupOpenApiDoc(
      SwaggerModule.createDocument(app, builder.build(), {
        operationIdFactory: operationId,
      }),
    ),
    uuidPathParameters(app),
  );
}
