import { redirect } from "next/navigation";
import { UsersIcon } from "lucide-react";
import { Role } from "@repo/contracts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import {
  NoMatchesNotice,
  Pager,
  RefusedSearchNotice,
  StalePageNotice,
} from "#shared/ui";
import { readUsersPage } from "../api/read-users-page";
import { activeFilters, readUsersSearch, usersHref } from "../lib/users-search";
import { UserCard } from "./user-card";
import { UsersToolbar } from "./users-toolbar";

/**
 * Every account on the site, a keyset page at a time, and the two things an admin may do
 * to one: change its role, and block or reopen it. The screen has the stays screen's
 * shape — the filters in the URL, one search at one address, a page that reads `no-store`
 * — because it is the same kind of list.
 */
export const UsersPage = async ({
  searchParams,
}: PageProps<"/admin/users">) => {
  const viewer = await requireRole(Role.ADMIN, ROUTES.adminUsers);
  const { query, errors, values, canonical } = readUsersSearch(
    await searchParams,
  );

  // One search, one address — see `canonical` in `bookings-search.ts`.
  if (canonical !== null) redirect(canonical);

  const page = query === null ? null : await readUsersPage(query);
  const staleCursor = query !== null && page === null;
  const filters = activeFilters(values);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Every account, newest first. A new role takes effect at the
          account&apos;s next sign-in or refresh, within fifteen minutes; a
          block ends its sessions at once.
        </p>
      </div>

      <UsersToolbar values={values} errors={errors} filters={filters} />

      {staleCursor && <StalePageNotice firstPageHref={usersHref(values)} />}

      {page !== null &&
        (page.items.length === 0 ? (
          filters.length > 0 ? (
            <NoMatchesNotice />
          ) : (
            // Unreachable while somebody is signed in to read it, and written anyway: the
            // list is the API's answer, not an assumption about who asked.
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersIcon />
                </EmptyMedia>
                <EmptyTitle>No accounts</EmptyTitle>
                <EmptyDescription>Nobody has registered yet.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        ) : (
          <ul role="list" className="flex flex-col gap-4">
            {page.items.map((user) => (
              <li key={user.id}>
                <UserCard user={user} viewer={viewer} />
              </li>
            ))}
          </ul>
        ))}

      {query === null && <RefusedSearchNotice />}

      {page !== null && (
        <Pager
          nextHref={
            page.nextCursor !== null ? usersHref(values, page.nextCursor) : null
          }
          firstHref={query?.cursor !== undefined ? usersHref(values) : null}
        />
      )}
    </div>
  );
};
