# Way of working

## Order of work on a task

1. First read the existing code next to the place being changed — style, naming and approach come from the neighbouring files, not from general habits.
2. Change the minimum necessary. Do not refactor things nobody asked about along the way.
3. After the changes, run from the root:

```sh
pnpm lint
pnpm check-types
```

For changes in `apps/api`, additionally `pnpm test`.

4. Code formatting is done by `pnpm lint:fix` from the root — Prettier is wired into ESLint through the `prettier/prettier` rule. `pnpm format` remains for `.md`, which ESLint does not parse. Do not align code by hand and do not argue with Prettier.

## Style

- The language of code, names and comments is English. Comments only where the "why" is not obvious; do not retell the code.
- The rule covers comments in every file of the repository, not only `.ts`/`.tsx`: `docker-compose.yml`, `.env.example`, `.gitignore`, `schema.prisma`, the ESLint and tsup configs are English too.
- Strings addressed to a developer are English as well: test descriptions in `it(...)`/`describe(...)` and the fixtures next to them, Nest exception messages, error texts in the `@repo/contracts` schemas, the output of scripts such as the seed and the demo data it writes.
- Documentation is English: every `README.md`, `CLAUDE.md`, `docs/`, this file and the rest of `.claude/`.
- **The whole repository is English, the interface included.** Labels, headings, button texts, `aria-label`s and the `lang` of the document in `apps/web` are English too — there is no Russian anywhere in the tree. That also keeps one language on both sides of the wire: messages from the `@repo/contracts` schemas and from API exceptions reach the interface as they are.
- When i18n appears, Russian comes back as a translation catalogue, not as a string typed into a component.
- The conversation with the user and commit messages are in Russian — they are not part of the tree.
- TypeScript strict in every package, `apps/api` included: no `any`, no `@ts-ignore`, no `!` to silence `noUncheckedIndexedAccess`. If a type is not inferred — describe it explicitly.
- Do not add new dependencies without need; first check whether something suitable is already in the repository.

## Git

- The main branch is `main`. Work happens in a separate branch off `main`, and the PR is opened into it.
- Commit and push only when explicitly asked.
- One commit is one meaningful change. The message is in Russian, in the imperative mood — the equivalent of "add the booking endpoint" or "fix CORS for several origins". The examples are spelled out in English here so that the tree itself stays free of Cyrillic; the commit still is not.
- Do not commit `.env` or the contents of `dist/`, `.next/`, `.turbo/`, `coverage/`.

## Documentation

When commands, environment variables or the set of packages change — update `README.md` and `CLAUDE.md` in the same change.

The root `README.md` is the only place for installation, environment variables and the shared commands. Package READMEs are short: purpose, a link to the root one and only what is specific to the package. Do not duplicate the shared instructions in them — those drift apart first.
