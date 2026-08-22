import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

/**
 * All of the Feature-Sliced checks, not half of them: the import boundaries as well as
 * what no per-file linter can see — a slice without a public API, a segment in the wrong
 * place, a slice with a single consumer. `eslint.config.js` holds none of them, and says
 * why: Steiger resolves an import to a file instead of matching the text of it, so a
 * relative walk into a sibling slice is caught here and named correctly.
 */
export default defineConfig([
  ...fsd.configs.recommended,
  {
    // Neither a font file nor the token import is a module Steiger can reason about.
    ignores: ["**/*.woff", "**/*.css"],
  },
  {
    // `_app` and `_pages` are the prefixes the FSD guide for Next.js prescribes, because
    // the framework owns both names. Steiger has no setting for renamed layers, so it
    // reads the prefix as a misspelling of `app` and `pages`. The check is switched off
    // for those two paths rather than globally; in practice it fires on little else — a
    // folder that resembles no layer at all (`shraed`) went unreported in a test.
    files: ["./src/_app/**", "./src/_pages/**"],
    rules: {
      "fsd/typo-in-layer-name": "off",
    },
  },
  {
    // Segments of the app layer, not slices: Steiger reads the prefixed folder as a
    // sliced layer and asks each of them to be divided further.
    files: ["./src/_app/**"],
    rules: {
      "fsd/no-segmentless-slices": "off",
    },
  },
]);
