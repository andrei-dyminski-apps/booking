import type { $ZodConfig } from "zod/v4/core";

// Zod 4 reads this shared config when its core loads. Set it before the first
// schema can probe `new Function` under the CSP, without importing Zod on every page.
const browser = globalThis as typeof globalThis & {
  __zod_globalConfig?: $ZodConfig;
};

(browser.__zod_globalConfig ??= {}).jitless = true;
