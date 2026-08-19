# apps/api — NestJS

## Stack

NestJS 11 on Express, TypeScript, Jest + Supertest. CommonJS (unlike `apps/web`) — built by `nest build` into `dist/`. Storage is PostgreSQL (docker-compose in the root) through Prisma 7.

The configuration is shared with the rest of the repository: `tsconfig.json` extends `@repo/typescript-config/nest.json`, `eslint.config.mjs` extends `@repo/eslint-config/nest-js`. Only `outDir` is declared locally. The stock Nest CLI settings (`noImplicitAny: false`, a disabled `no-explicit-any`, its own `.prettierrc`) were removed deliberately — do not bring them back when updating Nest or generating new files.

## Layout

Nest's modular organization: every domain area gets its own folder with `*.module.ts`, `*.controller.ts`, `*.service.ts`, and `dto/` and `entities/` when needed.

```
prisma/
  schema.prisma          # models; the client is generated into src/generated/prisma
  migrations/            # committed; created by pnpm --filter @repo/api db:migrate
  seed.ts                # demo data: pnpm --filter @repo/api db:seed
prisma.config.ts         # Prisma 7 config: loads the root .env, declares the seed command
src/
  app.module.ts          # root module: feature modules + the global ZodValidationPipe
  generated/prisma/      # the generated client — gitignored, never edit it
  prisma/                # PrismaModule + PrismaService (extends PrismaClient)
  booking/               # the reference for new domain areas
    booking.module.ts
    booking.controller.ts
    booking.service.ts
    booking.service.spec.ts
    dto/booking.dto.ts   # createZodDto on top of the @repo/contracts schemas
```

## Prisma

- Prisma 7 does not read `.env` on its own — `prisma.config.ts` loads the root `.env` through `process.loadEnvFile`; run the CLI only through the `db:*` scripts of `apps/api` (`pnpm --filter @repo/api db:migrate` and so on).
- The client is generated into `src/generated/prisma` (`prisma generate`, which also runs in `postinstall`); the directory is gitignored and in the ESLint ignores. The generator sets `importFileExtension = ""` — otherwise ts-node does not resolve the `.js` imports in the seed.
- Database access goes through `PrismaService` only (injected; `PrismaModule` is imported by the feature module). Do not create `new PrismaClient` inside services.
- The check-in/check-out columns are `@db.Date`, while dates are exposed as `YYYY-MM-DD` strings (the mapper in `BookingService`); the contract did not change when the storage did.
- A model change means a migration (`db:migrate`), and the migration files are committed.
- Prisma 7 dropped the automatic steps of v6: neither `migrate dev` nor `migrate reset` runs the seed script, and `migrate dev` no longer regenerates the client. So a schema change is `db:migrate` + `db:generate`, and a recreated database is `db:migrate` + `db:seed`.

Generate scaffolding through the Nest CLI rather than by hand:

```sh
pnpm --filter @repo/api exec nest g module booking
pnpm --filter @repo/api exec nest g controller booking
pnpm --filter @repo/api exec nest g service booking
```

## Code rules

- Dependencies come through constructor injection (`constructor(private readonly svc: BookingService)`). No manual `new` for providers.
- The controller stays thin: parse the request, call the service, return the result. Business logic lives in services.
- Input is validated by the `@repo/contracts` schemas through `nestjs-zod`. The schema is written in the contracts package, and only a DTO wrapper stays in `apps/api`:

```ts
// apps/api/src/booking/dto/booking.dto.ts
export class CreateBookingDto extends createZodDto(createBookingSchema) {}
```

The class is needed because Nest takes the metatype of the parameter from the runtime — an interface does not work here. The global `ZodValidationPipe` is already wired through `APP_PIPE` in `app.module.ts`, so per-route `@UsePipes` are unnecessary.

- Do not use `class-validator` and `class-transformer`: their decorators are not reused by the frontend, and the contract drifts apart.
- Format rules and relations between fields (including cross-field ones, such as "check-out after check-in") live in the contract schema. What stays in the service is what requires state: checks against other bookings, permissions, the database.
- Errors go through the built-in Nest exceptions (`NotFoundException`, `BadRequestException`), not through a manual `res.status(...)`.

## main.ts

`src/main.ts` is already set up and driven by environment variables:

- listens on `API_PORT ?? PORT ?? 3001` at `API_HOST ?? '0.0.0.0'`;
- CORS: the list of origins from `WEB_ORIGIN` (comma-separated), `credentials: true`;
- Swagger at `/docs`: the document is built from the same zod schemas, and `cleanupOpenApiDoc` is mandatory (in `nestjs-zod` 5 it replaced `patchNestJsSwagger`). It is published only when `NODE_ENV !== "production"` — the document describes the whole API surface.

Do not hardcode the port, the host or an origin. A new frontend origin goes into `.env`, not into the code.

## Tests

- Unit: `*.spec.ts` next to the code, `rootDir: src`, run with `pnpm test` from the root. No database needed: Prisma is mocked (`{ provide: PrismaService, useValue: ... }`), and the unit tests check the service logic around the queries. The script is a bare `jest` on purpose — see the note on `--experimental-vm-modules` below.
- E2E: `test/*.e2e-spec.ts`, config `test/jest-e2e.json`, run with `pnpm test:e2e` from the root. They hit the real database from docker-compose (it needs `docker compose up -d` and applied migrations) and wipe the tables in `beforeEach`. The script loads the root `.env` and enables `--experimental-vm-modules` — do not remove it. `maxWorkers: 1` in the same config is not optional either: the spec files share one database, and in parallel workers one file's cleanup wipes rows another one is working with.
- `--experimental-vm-modules` is needed by the tests that actually execute queries, not by every test that sees Prisma. Prisma 7 has no binary engine: with a driver adapter the generated client loads a WASM query compiler through `await import(...)` on `$connect()`, and Jest forbids a dynamic import inside its vm context without the flag. Unit tests replace `PrismaService` with a mock, so its constructor never runs and `$connect()` never happens — hence no flag there. If a unit spec starts failing with `A dynamic import callback was invoked without --experimental-vm-modules`, it has reached the real database: mock Prisma, do not add the flag.
- Both test tasks are declared in `turbo.json` with `dependsOn: ["^build"]`, so run them from the root. The specs import `@repo/contracts` schemas as values and need the built `dist/`; a direct `pnpm --filter @repo/api test` skips the build and fails on a fresh clone.
- A new controller or service comes with a spec modelled on `src/booking/booking.service.spec.ts` (`Test.createTestingModule`).
- In e2e, check the response with a schema from `@repo/contracts` (`bookingSchema.parse(response.body)`) — that way the test catches a drift from the contract, not only a status code.

## Checks

```sh
pnpm --filter @repo/api lint          # eslint . --max-warnings 0
pnpm --filter @repo/api lint:fix      # eslint . --fix, Prettier formatting included
pnpm --filter @repo/api check-types   # tsc --noEmit
```

The lint is type-aware (`recommendedTypeChecked`), so it catches what plain ESLint misses: unhandled promises, unsafe operations on `any`. Fix the rules rather than disabling them. A floating promise at the top level (like `void bootstrap()` in `main.ts`) is marked with an explicit `void`, not ignored.
