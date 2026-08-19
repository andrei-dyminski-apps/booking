# `@repo/eslint-config`

Shared ESLint configurations (flat config) for the packages of this repository.

| Preset                               | File                | Used by               |
| ------------------------------------ | ------------------- | --------------------- |
| `@repo/eslint-config/base`           | `base.js`           | the base for the rest |
| `@repo/eslint-config/next-js`        | `next.js`           | `apps/web`            |
| `@repo/eslint-config/nest-js`        | `nest.js`           | `apps/api`            |
| `@repo/eslint-config/react-internal` | `react-internal.js` | `packages/ui`         |

The base preset enables `eslint-plugin-only-warn`: every error is downgraded to a warning, while packages run the linter with `--max-warnings 0`. The outcome is the same — any remark fails the check — but the output reads uniformly.

## Prettier

Formatting is checked by ESLint itself: every preset ends with `eslint-plugin-prettier/recommended`. It turns on the `prettier/prettier` rule (a mismatch with the root `.prettierrc` becomes a lint remark, fixed by `pnpm lint:fix`) and pulls in `eslint-config-prettier`, which switches off the conflicting stylistic rules.

The position matters: in a flat config the last entry wins, so `eslint-plugin-prettier/recommended` has to come after every rule set. A new rule set is added to a preset **before** it.

A rule every package needs goes into `base.js`. A new preset is created per stack, not per package.
