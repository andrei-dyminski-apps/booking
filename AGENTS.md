# Repository instructions

Read and follow the existing project instructions before starting work:

- [CLAUDE.md](CLAUDE.md) — project overview, commands and shared conventions.
- [Monorepo rules](.claude/rules/monorepo.md) — package boundaries, tooling and configuration.
- [Workflow rules](.claude/rules/workflow.md) — development workflow, code style, checks and Git.

Before changing a shared package or a configuration file, read the
[monorepo configuration rules](.claude/rules/monorepo-config.md).
Use the `paths` list in that file to determine when it applies.

Read the application-specific instructions before changing files in that application:

- [Web instructions](apps/web/CLAUDE.md) for `apps/web/`.
- [API instructions](apps/api/CLAUDE.md) for `apps/api/`.

For frontend architecture and Feature-Sliced Design tasks, also read the
[Feature-Sliced Design skill](.claude/skills/feature-sliced-design/SKILL.md)
and any references relevant to the task. The web application's instructions take
precedence where they differ from the skill.

Use the Stripe CLI (`stripe`) and Railway CLI (`railway`) for service operations.
Follow the project commands and authorization requirements in [CLAUDE.md](CLAUDE.md).

Follow links and `@` imports in these instruction files by reading the referenced
files; do not assume they have been loaded automatically. Keep these files as the
source of truth rather than duplicating their rules here.
