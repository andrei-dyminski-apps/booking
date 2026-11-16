import { defineConfig } from "tsup";

export default defineConfig({
  // One entry per source file, so the ESM build is split into a module per file that
  // `index.mjs` re-exports. Together with `sideEffects: false` that lets the browser
  // bundle drop the files a page never reaches; a single bundled `index.mjs` would ship
  // every schema to every page. The CommonJS `index.js` stays self-contained for Node.
  // `src/testing` holds what the specs share; it imports vitest and is never shipped.
  entry: ["src/**/*.ts", "!src/**/*.spec.ts", "!src/testing/**"],
  // apps/web is ESM, apps/api is CommonJS, so both formats are needed.
  format: ["esm", "cjs"],
  splitting: true,
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
});
