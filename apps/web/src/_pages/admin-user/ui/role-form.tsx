"use client";

import { useActionState } from "react";
import type { Role } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError } from "@repo/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { ROLE_LABELS, roleOptions } from "#entities/user";
import { fieldMessages, NO_FORM_ERRORS, type FormErrors } from "#shared/lib";
import { changeRoleAction } from "../api/update-user-actions";

/**
 * The role of one account, as a box and a button. A plain `action={submit}` form rather
 * than `react-hook-form`: there is nothing to type, the box can only hold one of three
 * values, and the action parses what arrives against the contract anyway — a client-side
 * validation would have nothing to refuse.
 *
 * It asks for no confirmation, because a role is the change most easily undone on this
 * screen: the same box puts it back. What it does say is when the change lands — the
 * account carries its old role until its next refresh, which is the API's trade for an
 * access token that reads no database.
 */
export const RoleForm = ({
  userId,
  role,
  email,
}: {
  userId: string;
  role: Role;
  /** Whose role this is, for the label a screen reader announces with the box. */
  email: string;
}) => {
  const [errors, submit, pending] = useActionState<FormErrors, FormData>(
    changeRoleAction.bind(null, userId),
    NO_FORM_ERRORS,
  );
  const messages = [
    ...(errors.message === null ? [] : [errors.message]),
    ...(errors.fields.role ?? []),
  ];

  return (
    <form action={submit} noValidate className="flex flex-col gap-1">
      {/* Stacked and full-width on a phone, an inline row from `sm` up. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          name="role"
          defaultValue={role}
          items={ROLE_LABELS}
          disabled={pending}
        >
          <SelectTrigger
            size="sm"
            aria-label={`Role of ${email}`}
            className="w-full sm:w-32"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline" size="sm" loading={pending}>
          Save role
        </Button>
      </div>

      <FieldError errors={fieldMessages(messages)} />
    </form>
  );
};
