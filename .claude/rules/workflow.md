# Way of working

## Order of work on a task

1. First read the existing code next to the place being changed — style, naming and approach come from the neighbouring files, not from general habits.
2. Change the minimum necessary. Do not refactor things nobody asked about along the way.
3. After the changes, run from the root:

```sh
pnpm lint
pnpm check-types
```

For changes in `apps/api`, additionally `pnpm --filter @repo/api test`.

4. Code formatting is done by `pnpm lint:fix` from the root — Prettier is wired into ESLint through the `prettier/prettier` rule. `pnpm format` remains for `.md`, which ESLint does not parse. Do not align code by hand and do not argue with Prettier.

## Style

- The language of code, names and comments is English. Comments only where the "why" is not obvious; do not retell the code.
- The rule covers comments in every file of the repository, not only `.ts`/`.tsx`: `docker-compose.yml`, `.env.example`, `.gitignore`, `schema.prisma`, the ESLint and tsup configs are English too.
- Strings addressed to a developer are English as well: test descriptions in `it(...)`/`describe(...)`, Nest exception messages, error texts in the `@repo/contracts` schemas, output of scripts such as the seed.
- Documentation is English: every `README.md`, `CLAUDE.md`, `docs/`, this file and the rest of `.claude/`.
- Russian is left for what the end user reads: interface labels and texts in `apps/web` and the demo data of the seed.
- Messages from the contract schemas and API exceptions reach the interface as they are — the interface is therefore bilingual until i18n appears; new user-facing texts in `apps/web` are written in Russian.
- The conversation with the user and commit messages are in Russian.
- TypeScript strict in every package, `apps/api` included: no `any`, no `@ts-ignore`, no `!` to silence `noUncheckedIndexedAccess`. If a type is not inferred — describe it explicitly.
- Do not add new dependencies without need; first check whether something suitable is already in the repository.

## Git

- The main branch is `main`. Work happens in a separate branch off `main`, and the PR is opened into it.
- Commit and push only when explicitly asked.
- One commit is one meaningful change. The message is in Russian, in the imperative: «добавь эндпоинт бронирования», «почини CORS для нескольких origin».
- Do not commit `.env` or the contents of `dist/`, `.next/`, `.turbo/`, `coverage/`.

## Documentation

When commands, environment variables or the set of packages change — update `README.md` and `CLAUDE.md` in the same change.

The root `README.md` is the only place for installation, environment variables and the shared commands. Package READMEs are short: purpose, a link to the root one and only what is specific to the package. Do not duplicate the shared instructions in them — those drift apart first.
