import { nextJsConfig } from "@repo/eslint-config/next-js";

/**
 * The FSD rules are not here. Steiger (`steiger.config.js`, part of `pnpm lint`) owns them
 * all: it resolves an import to a file instead of matching the text of it, so it catches
 * what a per-file linter cannot — a relative path into a sibling slice, an import that
 * sidesteps a public API — and it also judges the shape of the tree. Duplicating half of
 * that here bought nothing but a second place for the rules to drift.
 */
export default nextJsConfig;
