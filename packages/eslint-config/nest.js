import globals from "globals";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import tseslint from "typescript-eslint";
import { config as baseConfig } from "./base.js";

/**
 * A shared ESLint configuration for NestJS applications.
 *
 * Adds type-aware linting on top of the base config and switches the
 * environment to CommonJS + Node/Jest globals.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const nestJsConfig = [
  ...baseConfig,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: "commonjs",
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    rules: {
      // Nest catches rejections itself, but an unmarked floating promise almost
      // always means a forgotten await in a service.
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
    },
  },
  eslintPluginPrettierRecommended,
  {
    ignores: ["dist/**", "eslint.config.mjs"],
  },
];
