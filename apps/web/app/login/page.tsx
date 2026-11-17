export { LoginPage as default, metadata } from "#_pages/auth/login";

// Next.js reads a segment's config out of this file's own source, so it is spelled here
// rather than re-exported. The page is allowed to block: its form has to work with no
// JavaScript, and content streamed into a `<Suspense>` stays hidden until a script reveals
// it — so the form is rendered in the response itself, `?next=` and all.
export const instant = false;
