import Link from "next/link";
import { type User } from "@repo/contracts";
import { ROLE_LABELS } from "#entities/user";
import { ROUTES } from "#shared/config";
import { ButtonLink } from "#shared/ui";
import { AccountLogout } from "./account-logout";

/**
 * The foot of the navigation, in both places that draw it: the sidebar on a wide screen
 * and the sheet on a narrow one. It carries the only two things a visitor needs from the
 * shell about themselves — who they are signed in as, and the way out.
 *
 * Its links and its "Sign out" close the sheet behind them, as the navigation's links do:
 * the sheet lives in the header, which a navigation keeps, so a link that only navigated —
 * or a sign-out that only went home — would leave it open over the page it opened.
 *
 * Nothing here is a permission. The role is a claim of a signed access token that only
 * the API can verify, and what it decides on this side is a word under a name.
 */
export const AccountPanel = ({
  user,
  onDone,
}: {
  user: User | null;
  /**
   * The sheet closes behind the link it opened and behind a sign-out; the sidebar has
   * nothing to close.
   */
  onDone?: () => void;
}) => {
  if (user === null) {
    return (
      <div className="flex flex-col gap-2">
        <ButtonLink href={ROUTES.register} onClick={onDone}>
          Create account
        </ButtonLink>
        <ButtonLink href={ROUTES.login} variant="ghost" onClick={onDone}>
          Sign in
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Link
        href={ROUTES.profile}
        onClick={onDone}
        className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-sidebar-accent/60"
      >
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground uppercase"
        >
          {initialsOf(user.name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm">{user.name}</span>
          <span className="text-xs text-muted-foreground">
            {ROLE_LABELS[user.role]}
          </span>
        </span>
      </Link>

      <AccountLogout variant="ghost" onSignedOut={onDone} />
    </div>
  );
};

/**
 * The first letter of the first two words — "Maya Lindqvist" is "ML", a single word is one
 * letter. Read by code point rather than by UTF-16 unit, so a letter outside the Basic
 * Multilingual Plane is not cut in half into a character nobody can draw.
 */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => Array.from(word).at(0) ?? "")
    .join("");
}
