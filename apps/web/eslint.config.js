import { globalIgnores } from "eslint/config";
import { nextJsConfig } from "@repo/eslint-config/next-js";

/**
 * The FSD rules are not here. Steiger (`steiger.config.js`, part of `pnpm lint`) owns them
 * all: it resolves an import to a file instead of matching the text of it, so it catches
 * what a per-file linter cannot — a relative path into a sibling slice, an import that
 * sidesteps a public API — and it also judges the shape of the tree. Duplicating half of
 * that here bought nothing but a second place for the rules to drift.
 */
export default [
  ...nextJsConfig,
  {
    // A Playwright fixture hands its value on through a callback named `use`, which the
    // rule takes for React's hook; nothing under e2e/ is React.
    files: ["e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  // What the browser suite writes: its report, and the traces and videos of a failure.
  globalIgnores(["playwright-report/**", "test-results/**", "blob-report/**"]),
];
