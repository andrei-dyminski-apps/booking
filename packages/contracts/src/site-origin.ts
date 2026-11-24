/** A bare host uses HTTPS. Paths and trailing slashes are dropped. */
export function normalizeWebOrigin(value: string | undefined): string | null {
  const input = value?.trim();
  if (!input || input === "*") return null;

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input)
    ? input
    : `https://${input}`;
  if (!URL.canParse(withScheme)) return null;

  const url = new URL(withScheme);
  return url.protocol === "https:" || url.protocol === "http:"
    ? url.origin
    : null;
}
