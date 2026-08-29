"use client";

import { useState } from "react";
import { MenuIcon } from "lucide-react";
import type { User } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/components/sheet";
import { AccountPanel } from "./account-panel";
import { NavLinks } from "./nav-links";

/**
 * The sidebar on a screen too narrow to keep it open. It is the same list and the same
 * account panel — only the container differs, so a section added to `navigation.ts`
 * appears in both without anybody remembering to add it twice.
 *
 * Closing is a click on a link rather than a route change watched from an effect: a link
 * to the page already open navigates nowhere, and a sheet waiting for a navigation that
 * never happens would stay over it.
 */
export const MobileNav = ({ user }: { user: User | null }) => {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Open the menu" />
        }
      >
        <MenuIcon />
      </SheetTrigger>

      <SheetContent side="left" className="w-68">
        <SheetHeader>
          <SheetTitle>Booking</SheetTitle>
          <SheetDescription>Rooms, dates and guests.</SheetDescription>
        </SheetHeader>

        <NavLinks
          user={user}
          className="px-3"
          onNavigate={() => {
            setOpen(false);
          }}
        />

        <div className="mt-auto border-t border-border p-3">
          <AccountPanel user={user} />
        </div>
      </SheetContent>
    </Sheet>
  );
};
