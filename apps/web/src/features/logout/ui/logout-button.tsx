"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOutIcon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { FieldError } from "@repo/ui/components/field";
import { cn } from "@repo/ui/lib/utils";
import { authApi } from "#shared/api";
import { ROUTES } from "#shared/config";
import { toFormErrors } from "#shared/lib";

/**
 * A feature rather than a piece of the profile page, because the shell offers it too: the
 * sidebar of a signed-in visitor ends in it, and having to walk to `/profile` to close a
 * session was the one thing the navigation could not do.
 *
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
export const LogoutButton = ({
  variant = "outline",
  className,
}: {
  /** The shell asks for a quieter one; the profile card keeps the outlined default. */
  variant?: "outline" | "ghost";
  className?: string;
}) => {
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
    <div className={cn("flex flex-col items-stretch gap-2", className)}>
      <Button
        type="button"
        variant={variant}
        onClick={signOut}
        loading={pending}
      >
        {/* The spinner from the primitive takes the icon's place while pending. */}
        {!pending && <LogOutIcon />}
        Sign out
      </Button>

      {message !== null && (
        <FieldError>{message} You are still signed in.</FieldError>
      )}
    </div>
  );
};
