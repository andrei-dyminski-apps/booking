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

- Every domain area is a separate module (`*.module.ts` + controller + service); generate the scaffolding with `pnpm --filter @repo/api exec nest g <module|controller|service> <name>`. `src/booking/` is the reference.
- Validation goes through the `@repo/contracts` schemas via `nestjs-zod`: `class CreateBookingDto extends createZodDto(createBookingSchema) {}`. The global `ZodValidationPipe` is wired in `app.module.ts`. `class-validator` is not used.
- Controllers stay thin, business logic lives in services, dependencies come through constructor injection — and an injected name is its type in camelCase (`bookingService`, `prismaService`, `userRepository`), never a shortening of it.
- Authentication lives in `src/auth/`: argon2 passwords, a JWT pair in httpOnly cookies and refresh-token rotation with reuse detection. `JwtAuthGuard` is registered globally through `APP_GUARD`, so a route is closed until it is marked `@Public()`, and `ThrottlerGuard` is registered ahead of it. The design and the environment variables are described in the [repository README](../../README.md#authentication).
- Database access goes through `PrismaService` only (`src/prisma/`), and in a module whose rules are worth testing on their own it goes through a `*.repository.ts` in front of it — `src/auth/` is the reference: the repository owns the query, the transaction and the mapping onto the contract types, the service keeps the rules and knows no Prisma. The client is generated into `src/generated/prisma` (gitignored, recreated by `postinstall`), the schema and migrations live in `prisma/`. Commands: `db:migrate`, `db:seed`, `db:generate`.
- Unlike the rest of the repository this package is CommonJS — the build runs through `nest build` (tsc), so `.ts` files from workspace packages cannot be imported directly: a shared package has to be either type-only or built (like `@repo/contracts`).
- Port, host and the CORS origin list are read from the environment (`API_PORT`, `API_HOST`, `WEB_ORIGIN`) in `src/main.ts` — never hardcode them.
- OpenAPI at `/docs` is built from the same zod schemas.
