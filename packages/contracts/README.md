# `@repo/contracts`

The API contract schemas — the single source of truth for `apps/api` and `apps/web`.

Every schema gives three things at once: validation on the server (through `nestjs-zod`), a type for both sides (`z.infer`) and form validation on the client.

```ts
import { createBookingSchema, type Booking } from "@repo/contracts";
```

## Why this package is built

`@repo/ui` exports its sources directly, which is not an option here: a zod schema is a value that has to exist at runtime, and `apps/api` does not bundle — `nest build` is `tsc`, which emits `require("@repo/contracts")` and leaves the resolution to Node.

So the package is built by tsup into two formats — `.mjs` for `apps/web` (ESM) and `.js` for `apps/api` (CommonJS).

`types` in `exports` points at `src/`, not at the emitted `.d.ts`. Type-checking therefore reads the sources: `pnpm lint` and `pnpm check-types` pass on a fresh clone with no `dist/` at all, and only `build` and the runtime need it. That is why neither task declares `dependsOn: ["^build"]` in `turbo.json`, while `build` and `dev` do.

There is no `dev` script in this package on purpose. The root `pnpm dev` runs `turbo watch dev`: a change in `src/` re-runs this package's `build` and restarts `apps/api`. A second `tsup --watch` would only race the same `dist/`.

## Rules

- Contract only: schemas, the types inferred from them and contract constants. Business logic, database access and http clients do not belong here.
- The one exception is a pure function that says what contract data means, when both sides have to apply it identically: `nightlyPrice` (`src/pricing.ts`) is the order in which a listing's prices apply to a night, which the listing page quotes by and the payment charges by. `refundOnCancel` (`src/refund.ts`) is the second: what a cancellation of a paid stay gives back, which the API refunds by and the stay's page states beforehand. Neither reads a database or the environment; the refund takes the moment it is asked about as an argument rather than reading the clock.
- Such a function gets a spec next to it (Vitest, `pnpm test` from the root): a quote and a charge that disagree would only show up as a complaint.
- A schema describes what actually travels over the network. Internal models of `apps/api` stay in `apps/api`.
- Change a schema — check both sides: `pnpm check-types` from the root reports the mismatch right away.
- Error messages in schemas are written in English: they are returned by the API and read by developers.
