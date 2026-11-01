/**
 * The request header the proxy hands a page's CSP nonce to the render under. Here rather
 * than beside the proxy because the layout reads it too, and the layout is reached from a
 * client error boundary that must not pull the proxy's server-only imports in.
 */
export const NONCE_HEADER = "x-nonce";
