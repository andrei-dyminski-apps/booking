// NEXT_PUBLIC_API_URL is inlined at `next build` time, so a missing value cannot be
// papered over with a localhost fallback: that would ship a bundle silently pointing
// at the developer's machine. Without it the build itself fails — Next evaluates this
// module while collecting page data — so the variable belongs to the build environment,
// not only to the runtime one.
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

if (!apiUrl) {
  throw new Error(
    "NEXT_PUBLIC_API_URL is not set. Copy .env.example to .env in the repository root and rebuild.",
  );
}

// A trailing slash in the variable would turn every request path into a double slash,
// so it is cut once here instead of at each call site of the client.
export const API_URL = apiUrl.replace(/\/+$/, "");
