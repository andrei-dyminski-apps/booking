import Link from "next/link";
import { Role, type User } from "@repo/contracts";
import { LogoutButton } from "#features/logout";
import { ROUTES } from "#shared/config";
import { ButtonLink } from "#shared/ui";

/**
 * The foot of the navigation, in both places that draw it: the sidebar on a wide screen
 * and the sheet on a narrow one. It carries the only two things a visitor needs from the
 * shell about themselves — who they are signed in as, and the way out.
 *
 * Nothing here is a permission. The role is a claim of a signed access token that only
 * the API can verify, and what it decides on this side is a word under a name.
 */
export const AccountPanel = ({ user }: { user: User | null }) => {
  if (user === null) {
    return (
      <div className="flex flex-col gap-2">
        <ButtonLink href={ROUTES.register}>Create account</ButtonLink>
        <ButtonLink href={ROUTES.login} variant="ghost">
          Sign in
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Link
        href={ROUTES.profile}
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
            {ROLE_LABEL[user.role]}
          </span>
        </span>
      </Link>

      <LogoutButton variant="ghost" />
    </div>
  );
};

/**
 * The three roles as a person reads them. Keyed by the contract's own enum rather than
 * switched over, so a fourth role stops compiling here instead of rendering as a blank.
 */
const ROLE_LABEL: Record<Role, string> = {
  [Role.USER]: "Guest",
  [Role.OWNER]: "Host",
  [Role.ADMIN]: "Administrator",
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
