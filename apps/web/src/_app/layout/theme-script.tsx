import { THEME_SCRIPT } from "#shared/config";

/**
 * Puts the saved theme on `<html>` before the first paint. It is the first thing in the
 * body, so it runs before any of the shell is drawn; why it is a constant and how the
 * policy lets it run is in `THEME_SCRIPT`.
 */
export const ThemeScript = () => (
  <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
);
