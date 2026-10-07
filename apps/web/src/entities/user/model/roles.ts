import { Role, roleSchema, type Role as RoleName } from "@repo/contracts";

/**
 * The three roles, named for a person. Keyed by the contract's enum, so a fourth role
 * stops compiling here instead of appearing as a blank option — and read by every badge,
 * filter and role box of the admin's screens, so one role has one name.
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
