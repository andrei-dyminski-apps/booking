import process from "node:process";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js writes an AGENTS.md and a CLAUDE.md of its own into this package on `dev`.
  // The instructions of this repository live in the root CLAUDE.md and .claude/rules,
  // and a second set generated next to them is a copy nobody updates.
  agentRules: false,
  // `next start` keeps the Data Cache in `.next/cache` across restarts, so a server started
  // on another database would serve the reads an earlier one cached — the browser suite's
  // stack reseeds on every run. With this set the fetches' cache lives in the process alone:
  // it works as it does anywhere else for the run, tags included, and is gone with it. Only
  // the fetches — a page entry is still read from `.next` either way, which holds nothing
  // of the data while every page that reads the API is dynamic. Read when the server
  // starts, so the same build serves both.
  experimental: {
    isrFlushToDisk: process.env.DATA_CACHE_IN_MEMORY !== "true",
  },
};

export default nextConfig;
