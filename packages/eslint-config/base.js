import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";
import onlyWarn from "eslint-plugin-only-warn";

const functionOverloads = [
  "function-overload",
  { selector: "ExportNamedDeclaration[declaration.type='TSDeclareFunction']" },
];

const functionExpression = "/^(ArrowFunctionExpression|FunctionExpression)$/";

const namedFunctions = [
  "function",
  ...functionOverloads,
  {
    selector:
      ":matches(ExportNamedDeclaration, ExportDefaultDeclaration)[declaration.type='FunctionDeclaration']",
  },
];

const functionDeclarations = [
  ...namedFunctions,
  {
    selector: `VariableDeclaration[declarations.0.init.type=${functionExpression}]`,
  },
  {
    selector: `ExportNamedDeclaration[declaration.declarations.0.init.type=${functionExpression}]`,
  },
  {
    selector: `ExportDefaultDeclaration[declaration.type=${functionExpression}]`,
  },
];

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
      "@stylistic": stylistic,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: functionDeclarations },
        { blankLine: "always", prev: functionDeclarations, next: "*" },
        {
          blankLine: "any",
          prev: functionOverloads,
          next: namedFunctions,
        },
      ],
      "@stylistic/lines-between-class-members": [
        "error",
        {
          enforce: [
            { blankLine: "always", prev: "*", next: "method" },
            { blankLine: "always", prev: "method", next: "*" },
          ],
        },
        { exceptAfterOverload: true },
      ],
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  // Runs Prettier as an ESLint rule (so `--fix` reformats) and turns off the
  // core rules it conflicts with. Must stay after every rule-defining config.
  eslintPluginPrettierRecommended,
  {
    ignores: ["dist/**"],
  },
];
