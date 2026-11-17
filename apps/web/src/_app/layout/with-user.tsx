import type { ReactNode } from "react";
import type { User } from "@repo/contracts";
import { currentUser } from "#shared/api";

/**
 * One island of the shell that differs per visitor: it reads the session and hands it to
 * whatever it wraps. Each of them sits in a `<Suspense>` of its own, so the rest of the
 * shell — and the page inside it — is prerendered once for everybody and the session is
 * streamed into the holes. Several islands still cost one call to `/auth/me`: `currentUser`
 * is memoized for the request.
 */
export const WithUser = async ({
  children,
}: {
  children: (user: User | null) => ReactNode;
}) => children(await currentUser());
