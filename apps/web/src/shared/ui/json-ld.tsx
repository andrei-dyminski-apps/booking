import { serializeJsonLd, type JsonLdNode } from "../lib";

/**
 * Structured data for a crawler, on the page whose data it describes. A data block is
 * never executed, so the Content-Security-Policy's nonce has nothing to say about it; what
 * keeps an owner's text from closing it early is `serializeJsonLd`.
 */
export const JsonLd = ({
  data,
}: {
  data: JsonLdNode | readonly JsonLdNode[];
}) => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
  />
);
