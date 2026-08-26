"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { refreshSession } from "#shared/api";

/**
 * What the header cannot do for itself. It renders on the server, where the only
 * credential in reach is the access token — fifteen minutes against the week the refresh
 * token lives — so a visitor who has been away for an hour is read as a stranger and
 * offered "Sign in" while their session is one rotation from being alive again.
 *
 * The transport already repairs exactly this, but only once something has been refused: a
 * 401 is what it reacts to, and a public page makes no request from the browser to be
 * refused. So the shell asks once on its own behalf, and only when the server has said
 * there is nobody — a signed-in render costs nothing here.
 *
 * Rotation is the browser's alone, which is why this is a client component rather than a
 * few lines in `header.tsx`: the refresh cookie is scoped to the `/auth` path of the proxy
 * and reaches neither a server render nor `proxy.ts`.
 */
export const SessionRecovery = ({ signedIn }: { signedIn: boolean }) => {
  const router = useRouter();

  useEffect(() => {
    if (signedIn) {
      // The session the attempt below was for. Releasing the latch here is what lets the
      // next expiry be repaired too, without it ever being released by a failure.
      attempt = "idle";

      return;
    }

    if (attempt !== "idle") return;

    void refreshSession().then((restored) => {
      // "recovered" is what closes the loop: `router.refresh()` renders the header again,
      // and a render that still reports nobody must not spend a second rotation asking the
      // same question. "exhausted" is the ordinary case of a visitor who is simply not
      // signed in — one refused request per page load, not one per navigation.
      attempt = restored ? "recovered" : "exhausted";

      if (restored) router.refresh();
    });
  }, [signedIn, router]);

  return null;
};

/**
 * Module-level rather than a ref, and it has to be: the point of the flag is to survive
 * the re-render this component asks for, and a ref would be reset by a remount of the
 * shell that caused it. A full page load is what starts over, which is the right unit —
 * that is one attempt per visit rather than one per page.
 */
let attempt: "idle" | "recovered" | "exhausted" = "idle";
