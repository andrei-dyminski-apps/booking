"use client";

// The directive is here as well as in the module it re-exports, for the same reason as in
// `error.tsx`: Next.js decides from this file whether the boundary is a Client Component.
export { GlobalError as default } from "#_app/layout";
