# @repo/api

The `booking` backend on NestJS 11 (Express), with PostgreSQL through Prisma 7.

Installation, environment variables and the shared commands are described in the [repository README](../../README.md) — everything is run from the root.

```sh
pnpm turbo run dev --filter=@repo/api     # nest start --watch
pnpm --filter @repo/api test              # unit, *.spec.ts next to the code
pnpm --filter @repo/api test:e2e          # e2e, test/*.e2e-spec.ts
pnpm --filter @repo/api test:cov          # coverage
```

Production build: `pnpm turbo run build --filter=@repo/api` (into `dist/`), start it with `pnpm --filter @repo/api start:prod`.

## Notable points

- Every domain area is a separate module (`*.module.ts` + controller + service + `*.repository.ts`); generate the scaffolding with `pnpm --filter @repo/api exec nest g <module|controller|service> <name>`. `src/listing/` is the reference for a plain one, `src/auth/` for a module whose rules need more than one repository.
- Validation goes through the `@repo/contracts` schemas via `nestjs-zod`: `class CreateBookingDto extends createZodDto(createBookingSchema) {}`. The global `ZodValidationPipe` is wired in `app.module.ts`. `class-validator` is not used.
- Controllers stay thin, business logic lives in services, dependencies come through constructor injection — and an injected name is its type in camelCase (`bookingService`, `prismaService`, `userRepository`), never a shortening of it.
- Authentication lives in `src/auth/`: argon2 passwords, a JWT pair in httpOnly cookies and refresh-token rotation with reuse detection. `JwtAuthGuard` is registered globally through `APP_GUARD`, so a route is closed until it is marked `@Public()`, and `ThrottlerGuard` is registered ahead of it. The design and the environment variables are described in the [repository README](../../README.md#authentication).
- Authorization is two checks in two places. `RolesGuard` is registered after `JwtAuthGuard` and answers from the access token alone which roles a route admits — `@Roles(Role.OWNER)` turns it on, and a route without the decorator is open to every signed-in role. Whether the row the caller named is theirs cannot be known before the row is read, so that half lives in the service beside the read, through `ownsOrIsAdmin` in `src/auth/ownership.ts`. The table of who may do what is in the [repository README](../../README.md#roles).
- Database access goes through `PrismaService` only (`src/prisma/`), and every entity reaches it through a `*.repository.ts` in front of it — CRUD modules included: the repository owns the query, the transaction and the mapping onto the contract types, the service keeps the rules and knows no Prisma. The client is generated into `src/generated/prisma` (gitignored, recreated by `postinstall`), the schema and migrations live in `prisma/`. Commands: `db:migrate`, `db:seed`, `db:generate`.
- Unlike the rest of the repository this package is CommonJS — the build runs through `nest build` (tsc), so `.ts` files from workspace packages cannot be imported directly: a shared package has to be either type-only or built (like `@repo/contracts`).
- Port, host and the CORS origin list are read from the environment (`API_PORT`, `API_HOST`, `WEB_ORIGIN`) in `src/main.ts` — never hardcode them. CORS is no longer what the frontend depends on: the browser reaches this API through a proxy on the frontend's own origin, so `WEB_ORIGIN` now serves `/docs` and direct clients. `TRUST_PROXY` is the number of `X-Forwarded-For` entries to believe, counted from the right — the frontend proxy forwards the header rather than appending to it, so what it changes is the entry the proxy in front of this service appends for the frontend server.
- OpenAPI at `/docs` is built from the same zod schemas.
