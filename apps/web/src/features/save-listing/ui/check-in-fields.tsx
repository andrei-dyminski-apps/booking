"use client";

import { useEffect, useId, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  canonicalTimeZone,
  DEFAULT_TIME_ZONE,
  type CreateListingInput,
} from "@repo/contracts";
import { Input } from "@repo/ui/components/input";
import { FormField } from "#shared/ui";
import type { ListingFormValues } from "../model/listing-form-schema";

/**
 * Where the place is and when a guest may arrive — the moment every refund window, the
 * host's fee and the payout of a stay are measured from. Every booking copies both, so a
 * change here moves no stay already taken.
 *
 * The zone is typed, with the names this browser knows offered as suggestions; the contract
 * decides whether the name is one. The suggestions are filled in when the box first takes
 * the focus: the server's list and the browser's need not agree, so a list rendered on both
 * sides would be a hydration error the moment they differ, and putting each of some four
 * hundred names through `canonicalTimeZone` is work a host who never opens the box should
 * not wait for. A new listing starts in the browser's own zone once it is known, unless the
 * box holds something other than UTC by then.
 */
export const CheckInFields = ({
  form,
  pending,
  creating,
}: {
  form: UseFormReturn<ListingFormValues, unknown, CreateListingInput>;
  pending: boolean;
  /** A new listing, which starts in the browser's zone rather than in UTC. */
  creating: boolean;
}) => {
  const listId = useId();
  const [zones, setZones] = useState<readonly string[]>([]);

  const suggestZones = () => {
    if (zones.length > 0) return;

    // Each under the name it would be stored as, so a renamed zone is offered as IANA spells
    // it today; and once, since a runtime may list `UTC` itself and two options under one
    // key are React's error.
    setZones([
      ...new Set([
        DEFAULT_TIME_ZONE,
        ...Intl.supportedValuesOf("timeZone").flatMap(
          (zone) => canonicalTimeZone(zone) ?? [],
        ),
      ]),
    ]);
  };

  useEffect(() => {
    // `null` for a zone the contract refuses — an `Etc/GMT-3` some systems run in.
    const own = canonicalTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );

    // Read off the value rather than `getFieldState(...).isDirty`, which is only kept up to
    // date for a form that subscribes to `formState.dirtyFields`, and this one does not.
    if (
      creating &&
      own !== null &&
      form.getValues("timeZone") === DEFAULT_TIME_ZONE
    ) {
      form.setValue("timeZone", own);
    }
  }, [creating, form]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField
        form={form}
        name="timeZone"
        label="Time zone"
        description="Where the place is, as a region such as Europe/Berlin. Check-in and every refund window of a stay are on this clock."
      >
        {(control) => (
          <>
            <Input
              {...control}
              size="lg"
              list={listId}
              onFocus={suggestZones}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
            />
            <datalist id={listId}>
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </>
        )}
      </FormField>

      <FormField
        form={form}
        name="checkInTime"
        label="Check-in from"
        description="The earliest a guest may arrive on the check-in day. A stay can be cancelled until this moment, and can be ended early from it."
      >
        {(control) => (
          <Input {...control} type="time" size="lg" disabled={pending} />
        )}
      </FormField>
    </div>
  );
};
