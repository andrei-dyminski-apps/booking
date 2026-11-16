"use client";

import dynamic from "next/dynamic";
import { LogOutIcon } from "lucide-react";
import { Button } from "@repo/ui/components/button";

// Loaded only once a session renders it. The account panel is drawn inside the mobile
// sheet, a Client Component, so a static import put the logout request — and with it the
// transport, the contract schemas and zod — into every stranger's first load. `dynamic()`
// splits only inside a Client Component, the same reason `account-notifications.tsx` exists.
//
// A render on the client — a sign-in's `router.refresh()`, the sheet opened for the first
// time — waits for the chunk, so the wait draws the same button, disabled: the panel keeps
// its height and nothing under the profile link jumps when the real one arrives. Only the
// panel's quiet variant is drawn, because the panel is the only caller.
export const AccountLogout = dynamic(
  () => import("#features/logout").then((module) => module.LogoutButton),
  {
    loading: () => (
      <div className="flex flex-col items-stretch gap-2">
        <Button type="button" variant="ghost" disabled>
          <LogOutIcon />
          Sign out
        </Button>
      </div>
    ),
  },
);
