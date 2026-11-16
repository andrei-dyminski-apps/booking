/** A value a JSON-LD node may hold — JSON, with an absent property left out. */
export type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonLdValue[]
  | { readonly [key: string]: JsonLdValue | undefined };

/** One schema.org thing, typed by its `@type`; the context is added when it is written. */
export type JsonLdNode = {
  readonly "@type": string;
  readonly [key: string]: JsonLdValue | undefined;
};

/**
 * The text of a `<script type="application/ld+json">`, with the schema.org context in front
 * — one node as the document itself, several as its `@graph`.
 *
 * What goes in is text somebody else wrote: an owner's title and description. The parser
 * of an HTML page closes a script at the first `</script` it meets, whatever the type says,
 * so such a title would end the block early and put the rest of the row into the page as
 * markup — and `JSON.stringify` leaves a `<` as it is. Every `<` is written as `\u003c`
 * instead, which a JSON parser reads back as the same character and an HTML parser never
 * sees: no `</script`, no `<!--`, nothing it can take for a tag.
 */
export function serializeJsonLd(
  nodes: JsonLdNode | readonly JsonLdNode[],
): string {
  const document = Array.isArray(nodes)
    ? { "@context": "https://schema.org", "@graph": nodes }
    : { "@context": "https://schema.org", ...nodes };

  return JSON.stringify(document).replace(/</g, "\\u003c");
}

/** One step of a trail, by its name and the absolute URL of its page. */
export type Crumb = { name: string; url: string };

/** The trail from the home page down to the page that states it, in that order. */
export function breadcrumbJsonLd(trail: readonly Crumb[]): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map(({ name, url }, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: url,
    })),
  };
}
