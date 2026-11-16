import { config } from "zod/v4/core";

// Skips zod's `new Function` probe, which the CSP refuses — see "The site sends a
// Content-Security-Policy" in apps/web/CLAUDE.md.
config({ jitless: true });
