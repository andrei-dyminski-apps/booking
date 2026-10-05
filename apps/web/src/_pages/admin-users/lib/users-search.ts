import {
  Role,
  roleSchema,
  userQuerySchema,
  userSortSchema,
  UserStatus,
  userStatusSchema,
  type Role as RoleName,
  type UserQuery,
  type UserSort,
  type UserStatus as UserStatusName,
} from "@repo/contracts";
import { ROUTES } from "#shared/config";
import {
  filtersHref,
  searchParamsHref,
  singleParam,
  toFieldErrors,
  type FieldErrors,
} from "#shared/lib";
import type { SortOption } from "#shared/ui";

/**
 * What the boxes of the filter form hold — text, because that is what a URL carries. The
 * shape `bookings-search.ts` gives the stays, over accounts; `sort` travels with the
 * filters for the reason it does there.
 */
export type FilterValues = {
  role: string;
  status: string;
  email: string;
  sort: string;
};

export type UsersSearch = {
  /** The question to put to the API, or `null` when the URL holds one it cannot answer. */
  query: UserQuery | null;
  errors: FieldErrors;
  values: FilterValues;
  /** The address this search belongs at, or `null` when the URL already spells it. */
  canonical: string | null;
};

/**
 * The filters of the users screen as they arrive: untrusted text, parsed by the schema
 * that validates the same query string in Nest, with what it refuses shown under the box
 * it belongs to. One search, one address — the rule both other lists keep, and for the
 * same reason: the dialog is a `GET` form and submits every box it has.
 */
export function readUsersSearch(
  params: Record<string, string | string[] | undefined>,
): UsersSearch {
  const values: FilterValues = {
    role: singleParam(params.role),
    status: singleParam(params.status),
    email: singleParam(params.email),
    sort: singleParam(params.sort),
  };

  const cursor = singleParam(params.cursor);
  const parsed = userQuerySchema.safeParse({ ...values, cursor });

  const href = usersHref(values, cursor === "" ? undefined : cursor);
  const canonical =
    href === searchParamsHref(ROUTES.adminUsers, params) ? null : href;

  return parsed.success
    ? { query: parsed.data, errors: {}, values, canonical }
    : {
        query: null,
        errors: toFieldErrors(parsed.error.issues),
        values,
        canonical,
      };
}

/** A link to the users carrying these filters, and the next page when a cursor is handed over. */
export function usersHref(values: FilterValues, cursor?: string): string {
  return filtersHref(ROUTES.adminUsers, values, cursor);
}

/**
 * The three roles, named for a person. Keyed by the contract's enum, so a fourth role
 * stops compiling here instead of appearing as a blank option — and read by the badge on
 * every row as well as by the filter and the role box, so one role has one name.
 */
export const ROLE_LABELS: Record<RoleName, string> = {
  [Role.USER]: "Guest",
  [Role.OWNER]: "Owner",
  [Role.ADMIN]: "Admin",
};

export const roleOptions = roleSchema.options.map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));

export const STATUS_LABELS: Record<UserStatusName, string> = {
  [UserStatus.ACTIVE]: "Active",
  [UserStatus.BLOCKED]: "Blocked",
};

export const statusOptions = userStatusSchema.options.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

const SORT_LABELS: Record<UserSort, string> = {
  newest: "Joined most recently",
  oldest: "Joined first",
};

/** The default `userQuerySchema` writes, known here before the query is parsed. */
const DEFAULT_SORT: UserSort = "newest";

/** The orderings the contract offers, each a link to this same search under it. */
export function sortOptions(values: FilterValues): SortOption[] {
  const current = currentSort(values.sort);

  return userSortSchema.options.map((value) => ({
    value,
    label: SORT_LABELS[value],
    href: usersHref({ ...values, sort: value === DEFAULT_SORT ? "" : value }),
    current: value === current,
  }));
}

/** The same ordering with nothing filtered — an ordering is not a filter. */
export function clearedFiltersHref(values: FilterValues): string {
  return usersHref({ role: "", status: "", email: "", sort: values.sort });
}

function currentSort(value: string): UserSort | null {
  if (value === "") return DEFAULT_SORT;

  const parsed = userSortSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/** A filter as a chip: what it says, and the link that takes it off. */
export type ActiveFilter = {
  key: string;
  label: string;
  /** The same search without this filter — and without a cursor, see `usersHref`. */
  href: string;
};

/**
 * What is currently being filtered by, as chips. A value the contract refused is shown as
 * it was typed: it came out of a URL, and the chip is what takes the refusal off again.
 */
export function activeFilters(values: FilterValues): ActiveFilter[] {
  const filters: ActiveFilter[] = [];

  if (values.role !== "") {
    filters.push({
      key: "role",
      label: roleLabel(values.role),
      href: usersHref({ ...values, role: "" }),
    });
  }

  if (values.status !== "") {
    filters.push({
      key: "status",
      label: statusLabel(values.status),
      href: usersHref({ ...values, status: "" }),
    });
  }

  if (values.email !== "") {
    filters.push({
      key: "email",
      label: `Address has “${values.email}”`,
      href: usersHref({ ...values, email: "" }),
    });
  }

  return filters;
}

/** A role for a chip to carry, or the text as it arrived when the contract refused it. */
function roleLabel(value: string): string {
  const parsed = roleSchema.safeParse(value);

  return parsed.success ? ROLE_LABELS[parsed.data] : value;
}

/** The same, for whether an account may sign in. */
function statusLabel(value: string): string {
  const parsed = userStatusSchema.safeParse(value);

  return parsed.success ? STATUS_LABELS[parsed.data] : value;
}
