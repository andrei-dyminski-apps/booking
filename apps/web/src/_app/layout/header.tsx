import Link from "next/link";
import { Button } from "@repo/ui/components/button";
import { currentUser } from "#shared/api";
import { ROUTES } from "#shared/config";
import { ThemeToggle } from "./theme-toggle";

/**
 * The frame every page is rendered inside, which is why it lives in the app layer rather
 * than in a slice of its own. Reading the session here is what opts the whole tree out of
 * static rendering — the header differs per visitor, so no page above it can be a shared
 * document. That is the right trade while every screen is behind a login; the catalogue
 * of phase 6 is the first one that will want the opposite and will have to say so.
 */
export const Header = async () => {
  const user = await currentUser({ cache: "no-store" });

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href={ROUTES.home} className="font-semibold tracking-tight">
          Booking
        </Link>

        <nav className="flex items-center gap-2">
          {user ? (
            <Button variant="ghost" render={<Link href={ROUTES.profile} />}>
              {user.email}
            </Button>
          ) : (
            <>
              <Button variant="ghost" render={<Link href={ROUTES.login} />}>
                Sign in
              </Button>
              <Button render={<Link href={ROUTES.register} />}>Sign up</Button>
            </>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
};
