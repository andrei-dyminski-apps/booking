"use client";

// The directive is here as well as in the module it re-exports: Next.js reads this file
// to decide whether the boundary is a Client Component, and it decides that from the file
// rather than from where the export came from.
export { ErrorPage as default } from "#_pages/fallback/error";
