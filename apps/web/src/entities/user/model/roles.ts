import { Role, roleSchema, type Role as RoleName } from "@repo/contracts";

/**
 * The roles, named for a person. Keyed by the contract's enum, so a third role
 * stops compiling here instead of appearing as a blank option — and read by the account
 * panel and every badge, filter and role box of the admin's screens, so one role has one
 * name. A user is a "Member", not a guest or a host: one account is both, depending on
 * the stay.
 */
export const ROLE_LABELS: Record<RoleName, string> = {
  [Role.USER]: "Member",
  [Role.ADMIN]: "Administrator",
};

export const roleOptions = roleSchema.options.map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));
