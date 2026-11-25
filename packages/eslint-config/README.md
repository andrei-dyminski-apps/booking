# `@repo/eslint-config`

Shared ESLint configurations (flat config) for the packages of this repository.

| Preset                               | File                | Used by               |
| ------------------------------------ | ------------------- | --------------------- |
| `@repo/eslint-config/base`           | `base.js`           | the base for the rest |
| `@repo/eslint-config/next-js`        | `next.js`           | `apps/web`            |
| `@repo/eslint-config/nest-js`        | `nest.js`           | `apps/api`            |
| `@repo/eslint-config/react-internal` | `react-internal.js` | `packages/ui`         |
| `@repo/eslint-config/tailwind`       | `tailwind.js`       | part of the two above |

The base preset enables `eslint-plugin-only-warn`: every error is downgraded to a warning, while packages run the linter with `--max-warnings 0`. The outcome is the same — any remark fails the check — but the output reads uniformly.

## Prettier

Formatting is checked by ESLint itself: every preset ends with `eslint-plugin-prettier/recommended`. It turns on the `prettier/prettier` rule (a mismatch with the root `.prettierrc` becomes a lint remark, fixed by `pnpm lint:fix`) and pulls in `eslint-config-prettier`, which switches off the conflicting stylistic rules.

The position matters: in a flat config the last entry wins, so `eslint-plugin-prettier/recommended` has to come after every rule set. A new rule set is added to a preset **before** it.

A rule every package needs goes into `base.js`. A new preset is created per stack, not per package.

## Tailwind

`tailwind.js` enables the recommended rules of `eslint-plugin-better-tailwindcss` for `.ts`/`.tsx` and is included by `next-js` and `react-internal`, before Prettier. Its entry point is the one stylesheet that holds the tokens and the `@source` directives, `packages/ui/src/styles/globals.css`, resolved to an absolute path because every package lints from its own directory. `enforce-consistent-line-wrapping` is off (Prettier does not wrap strings, and re-wrapping would rewrite every shadcn primitive on each `shadcn add`); `no-unknown-classes` ignores `toaster`, the hook class Sonner styles itself through.

The base preset uses ESLint Stylistic to require a blank line around function declarations, variables initialized with functions, and class methods. TypeScript overload signatures can stay together with their implementation. `pnpm lint:fix` adds the missing blank lines.
