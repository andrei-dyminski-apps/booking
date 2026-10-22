"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshSession } from "#shared/api";

export type SessionResume = "checking" | "anonymous";

/**
 * An access token lives fifteen minutes and a refresh token a week, so most visitors sent
 * here by the proxy are not signed out at all — they are one rotation away from being
 * signed in again. Only the browser can perform it: the refresh cookie is scoped to the
 * `/auth` path of the proxy, so neither the middleware nor a server render ever sees it.
 *
 * Hence the trade beside the form: one request that either restores the session and
 * leaves for `target`, or reports that there is nothing to restore. It runs next to the
 * form rather than in front of it — any failure means the same thing to the visitor, and
 * a form withheld until a hook answers would not be there for one that arrives with no
 * JavaScript at all.
 *
 * The shell runs the same rotation from the header, and it is the same one: `refreshSession`
 * is single-flight, so the two join a single request. What this adds is where to go
 * afterwards, which only the login page knows.
 *
 * A cold arrival is the case this covers and the transport cannot: nothing has been
 * refused yet, so there is no 401 for `apiRequest` to react to.
 */
export function useSessionResume(target: string): SessionResume {
  const router = useRouter();
  const [state, setState] = useState<SessionResume>("checking");

  useEffect(() => {
    // No guard against the two effect runs of StrictMode: `refreshSession` is
    // single-flight, so the second run joins the first attempt instead of racing it for
    // a token the first one is in the middle of burning.
    void refreshSession().then((restored) => {
      if (!restored) {
        setState("anonymous");

        return;
      }

      router.replace(target);
      router.refresh();
    });
  }, [router, target]);

  return state;
}
