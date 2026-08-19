import path from "node:path";
import { defineConfig } from "prisma/config";

// The only .env lives in the repository root, and Prisma 7 does not read .env itself.
// The path is resolved from this file rather than from cwd, so the CLI also works when
// invoked from the repository root (pnpm exec prisma studio, CI steps).
try {
  process.loadEnvFile(path.join(__dirname, "../../.env"));
} catch {
  // No .env file — variables come from the environment instead (CI, for example).
}

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  // Without DATABASE_URL only commands that need no database work (prisma generate).
  ...(databaseUrl === undefined ? {} : { datasource: { url: databaseUrl } }),
  migrations: {
    seed: "node -r ts-node/register prisma/seed.ts",
  },
});
