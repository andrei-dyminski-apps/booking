# .claude

Claude Code configuration for this repository.

| File                  | Purpose                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `../CLAUDE.md`        | Entry point: project overview, commands, env. Loaded automatically |
| `rules/monorepo.md`   | pnpm, package boundaries, configs, turbo.json                      |
| `rules/workflow.md`   | Way of working, code style, git, documentation                     |
| `skills/`             | Vendored agent skills, loaded on demand rather than every session  |
| `settings.json`       | Command permissions (committed to the repository)                  |
| `settings.local.json` | Personal overrides, not committed                                  |

The files in `rules/` are wired in through `@` imports at the end of `CLAUDE.md` — a new rules file has to be added there, otherwise it will not be loaded. They hold what applies to the whole repository, so they are in context in every session.

What applies to one application lives with it instead — `../apps/web/CLAUDE.md` and `../apps/api/CLAUDE.md` — and is loaded when a file under that directory is, not before. That is where the bulk of the rules are, and it keeps a session that never opens `apps/web` from carrying its conventions.

## Skills

`skills/feature-sliced-design/` is the official Feature-Sliced Design skill (v2.1),
vendored from [feature-sliced/skills](https://github.com/feature-sliced/skills) at commit
`16df62d`. Unlike `rules/`, a skill is not loaded into every session: Claude reads
`SKILL.md` when a task is about project structure, and pulls a file out of `references/`
only when that specific question comes up.

It is committed rather than installed per machine, so everyone gets the same version and a
bump is a reviewable diff. To update it, copy `feature-sliced-design/` out of a fresh clone
of the upstream repository and note the new commit here:

```sh
git clone --depth 1 https://github.com/feature-sliced/skills.git
cp -r skills/feature-sliced-design .claude/skills/
```

The skill states the methodology; `../apps/web/CLAUDE.md` states what this repository decided
to do with it, and wins where the two disagree — the section "The methodology itself"
there lists the disagreements.

These files are written in English, like everything else in the repository — code, comments, tests, READMEs, `docs/`, and the interface of `apps/web` down to its `aria-label`s and the demo data of the seed. What stays in Russian is what never lands in the tree: the conversation with the assistant, and commit messages. The rule in full is in `rules/workflow.md`.

The rules describe what cannot be derived from the code: agreements and boundaries. There is no need to duplicate the directory layout or the contents of `package.json` in them — that goes stale first.
