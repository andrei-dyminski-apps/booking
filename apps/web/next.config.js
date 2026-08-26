/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js writes an AGENTS.md and a CLAUDE.md of its own into this package on `dev`.
  // The instructions of this repository live in the root CLAUDE.md and .claude/rules,
  // and a second set generated next to them is a copy nobody updates.
  agentRules: false,
};

export default nextConfig;
