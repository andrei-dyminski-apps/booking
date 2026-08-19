// @ts-check
import { nestJsConfig } from "@repo/eslint-config/nest-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nestJsConfig,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The generated Prisma client is not linted: prisma generate recreates it.
    ignores: ["src/generated/**"],
  },
];
