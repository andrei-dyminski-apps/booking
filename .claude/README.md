# .claude

Claude Code configuration for this repository.

| File                  | Purpose                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `../CLAUDE.md`        | Entry point: project overview, commands, env. Loaded automatically |
| `rules/monorepo.md`   | pnpm, package boundaries, configs, turbo.json                      |
| `rules/frontend.md`   | `apps/web` — Next.js, Server/Client Components, styling            |
| `rules/backend.md`    | `apps/api` — NestJS, module layout, Prisma, tests                  |
| `rules/workflow.md`   | Way of working, code style, git, documentation                     |
| `settings.json`       | Command permissions (committed to the repository)                  |
| `settings.local.json` | Personal overrides, not committed                                  |

The files in `rules/` are wired in through `@` imports at the end of `CLAUDE.md` — a new rules file has to be added there, otherwise it will not be loaded.

These files are written in English, like everything else in the repository — code, comments, tests, READMEs, `docs/`. What stays in Russian is the interface text of `apps/web`, the demo data of the seed, and the conversation with the assistant itself, including commit messages.

The rules describe what cannot be derived from the code: agreements and boundaries. There is no need to duplicate the directory layout or the contents of `package.json` in them — that goes stale first.
