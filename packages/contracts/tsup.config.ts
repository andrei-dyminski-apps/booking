import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  // apps/web is ESM, apps/api is CommonJS, so both formats are needed.
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
});
