"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@repo/ui/components/button";
import { authApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import { toFormErrors } from "#shared/lib";

/**
 * The one mutation of the session that cannot be a Server Action, and the cookie scopes
 * are the reason. Ending a session means revoking the refresh family, and the API can only
 * be handed the refresh token by the side that holds it: it is scoped to the `/auth` path
 * of the proxy, so a Server Action — which posts to the URL of the page it sits on — never
 * receives it. The API would then clear the cookies of a family it did not revoke, and a
 * stolen token would outlive the "Sign out" by a week.
 *
 * Called from here the request goes to `/api/auth/logout`, which is inside that scope, so
 * the proxy is handed the token and forwards it. The cookies are cleared by the same
 * mirroring that issued them, and `router.refresh()` is what re-renders the shell for a
 * stranger — the client-side half of the `refresh()` the other two actions call.
 */
export const LogoutButton = () => {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const signOut = () => {
    startTransition(async () => {
      try {
        await authApi.logout();
      } catch (error) {
        // The endpoint answers the same way with or without a session, so the only way to
        // fail is a request that never arrived — and then the cookies are still here.
        setMessage(toFormErrors(error).message);

        return;
      }

      router.replace(ROUTES.home);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={signOut}
        disabled={pending}
      >
        {pending ? "Signing out…" : "Sign out"}
      </Button>

      {message !== null && (
        <p className="text-sm text-destructive">
          {message} You are still signed in.
        </p>
      )}
    </div>
  );
};
