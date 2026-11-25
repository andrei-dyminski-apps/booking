import { resolve } from "node:path";
import eslintPluginBetterTailwindcss from "eslint-plugin-better-tailwindcss";

/**
 * Tailwind class linting for the packages that write markup.
 *
 * The design tokens and the `@source` globs live in one stylesheet, the one `apps/web`
 * loads, so the entry point is that file for every consumer; the path is absolute
 * because the linter runs with each package as its working directory.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const tailwindConfig = [
  {
    files: ["**/*.{ts,tsx}"],
    ...eslintPluginBetterTailwindcss.configs.recommended,
    rules: {
      ...eslintPluginBetterTailwindcss.configs.recommended.rules,
      // Prettier never wraps a string, and re-wrapping every long class list would
      // rewrite each shadcn primitive on every `shadcn add`.
      "better-tailwindcss/enforce-consistent-line-wrapping": "off",
      // `toaster` is the hook class Sonner styles itself through, not a utility.
      "better-tailwindcss/no-unknown-classes": [
        "error",
        { ignore: ["^toaster$"] },
      ],
    },
    settings: {
      "better-tailwindcss": {
        entryPoint: resolve(
          import.meta.dirname,
          "../ui/src/styles/globals.css",
        ),
      },
    },
  },
];
