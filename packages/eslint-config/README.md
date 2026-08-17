# `@repo/eslint-config`

Общие конфигурации ESLint (flat config) для пакетов репозитория.

| Пресет                               | Файл                | Кто использует       |
| ------------------------------------ | ------------------- | -------------------- |
| `@repo/eslint-config/base`           | `base.js`           | основа для остальных |
| `@repo/eslint-config/next-js`        | `next.js`           | `apps/web`           |
| `@repo/eslint-config/nest-js`        | `nest.js`           | `apps/api`           |
| `@repo/eslint-config/react-internal` | `react-internal.js` | `packages/ui`        |

Базовый пресет включает `eslint-plugin-only-warn`: все ошибки понижаются до предупреждений, а пакеты запускают линт с `--max-warnings 0`. Итог тот же — любое замечание роняет проверку, — но вывод читается единообразно.

## Prettier

Форматирование проверяется самим ESLint: во всех пресетах последним элементом стоит `eslint-plugin-prettier/recommended`. Он включает правило `prettier/prettier` (расхождение с корневым `.prettierrc` = замечание линта, чинится через `pnpm lint:fix`) и подключает `eslint-config-prettier`, который гасит конфликтующие стилистические правила.

Позиция важна: во flat config побеждает последний конфиг, поэтому `eslint-plugin-prettier/recommended` должен идти после всех наборов правил. Новый набор правил в пресете добавляется **до** него.

Правило, нужное всем пакетам, добавляется в `base.js`. Новый пресет — под конкретный стек, а не под отдельный пакет.
