"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_PUSH_PREFERENCES,
  pushGroupSchema,
  pushPreferencesPatchSchema,
  type PushGroup,
  type PushPreferences,
  type PushPreferencesPatch,
} from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { ApiResponseError, pushApi } from "#shared/api";
import { browserTimeZone, toFormErrors } from "#shared/lib";

const labels: Record<PushGroup, string> = {
  stays: "Bookings and cancellations",
  payments: "Payments and payouts",
  messages: "New messages",
  reviews: "Reviews",
  waitlist: "Waitlist openings",
  alerts: "Admin alerts",
};

/**
 * The limits offered. The contract takes any whole number up to its own ceiling, so a
 * saved value outside this list is offered beside them rather than drawn as a blank box.
 */
const LIMITS = ["1", "3", "10", "30"];

/** A list rather than a record: a record would put the numeric keys before `none`. */
function limitOptions(saved: number | null): [value: string, label: string][] {
  const values = new Set(LIMITS);
  if (saved !== null) values.add(String(saved));

  return [
    ["none", "No limit"],
    ...[...values]
      .sort((a, b) => Number(a) - Number(b))
      .map((value): [string, string] => [value, `${value} an hour`]),
  ];
}

const DEFAULT_QUIET = { from: "22:00", to: "07:00" };

type Draft = {
  muted: PushGroup[];
  quiet: boolean;
  from: string;
  to: string;
  limit: string;
};

function draftOf(preferences: PushPreferences): Draft {
  return {
    muted: preferences.muted,
    quiet: preferences.quietHours !== null,
    from: preferences.quietHours?.from ?? DEFAULT_QUIET.from,
    to: preferences.quietHours?.to ?? DEFAULT_QUIET.to,
    limit:
      preferences.hourlyLimit === null
        ? "none"
        : String(preferences.hourlyLimit),
  };
}

function quietHoursChanged(draft: Draft, saved: PushPreferences): boolean {
  const original = saved.quietHours;

  return draft.quiet
    ? original === null ||
        draft.from !== original.from ||
        draft.to !== original.to
    : original !== null;
}

/**
 * How the account is pushed to, on every browser it turned notifications on in — beside
 * the email settings, since it is the account's and not the device's. A changed quiet
 * window uses the browser's time zone. Other edits leave the saved window as it was.
 * What the push carries and
 * whether a device takes it at all are the "This device" section's.
 *
 * `admin` adds the group only an admin is told about.
 */
export const PushSettings = ({
  userId,
  admin,
}: {
  userId: string;
  admin: boolean;
}) => {
  const [saved, setSaved] = useState<PushPreferences | null>(null);
  const [draft, setDraft] = useState(() => draftOf(DEFAULT_PUSH_PREFERENCES));
  const [browserZone, setBrowserZone] = useState("UTC");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const loadRequest = useRef<AbortController | null>(null);
  const groups = pushGroupSchema.options.filter(
    (group) => admin || group !== "alerts",
  );
  const limits = limitOptions(saved?.hourlyLimit ?? null);
  const quietChanged = saved !== null && quietHoursChanged(draft, saved);
  const zone = quietChanged
    ? browserZone
    : (saved?.quietHours?.timeZone ?? browserZone);

  useEffect(() => () => loadRequest.current?.abort(), []);

  async function load() {
    loadRequest.current?.abort();
    const request = new AbortController();
    loadRequest.current = request;
    setSaved(null);
    setLoading(true);
    setStatus("");
    setBrowserZone(browserTimeZone());

    try {
      const preferences = await pushApi.settings(userId, request.signal);
      if (request.signal.aborted) return;

      setSaved(preferences);
      setDraft(draftOf(preferences));
    } catch (error) {
      if (request.signal.aborted) return;

      if (accountChanged(error)) {
        setDraft(draftOf(DEFAULT_PUSH_PREFERENCES));
        setStatus(error.message);
      } else {
        setStatus("Could not load notification preferences.");
      }
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }

  async function save() {
    if (saved === null) return;

    // Only what changed is checked and sent: the saved window keeps the zone it was stored
    // with, which this browser's `Intl` may not know.
    const hourlyLimit = draft.limit === "none" ? null : Number(draft.limit);
    const patch: PushPreferencesPatch = {};
    for (const group of groups) {
      const muted = draft.muted.includes(group);
      if (muted !== saved.muted.includes(group)) {
        patch.groups ??= {};
        patch.groups[group] = !muted;
      }
    }
    if (quietChanged) {
      patch.quietHours = draft.quiet
        ? { from: draft.from, to: draft.to, timeZone: zone }
        : null;
    }
    if (saved.hourlyLimit !== hourlyLimit) patch.hourlyLimit = hourlyLimit;
    if (Object.keys(patch).length === 0) {
      setStatus("No changes to save.");

      return;
    }

    const parsed = pushPreferencesPatchSchema.safeParse(patch);
    if (!parsed.success) {
      setStatus(parsed.error.issues[0]?.message ?? "Please check the times.");

      return;
    }

    setPending(true);
    setStatus("");

    try {
      await pushApi.savePreferences(userId, parsed.data);
      setSaved({
        muted: draft.muted,
        quietHours:
          parsed.data.quietHours === undefined
            ? saved.quietHours
            : parsed.data.quietHours,
        hourlyLimit,
      });
      setStatus("Notification preferences saved.");
    } catch (error) {
      if (accountChanged(error)) {
        setSaved(null);
        setDraft(draftOf(DEFAULT_PUSH_PREFERENCES));
      }
      setStatus(toFormErrors(error).message ?? "Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(open, event) => {
        if (pending) event.cancel();
        else if (open) void load();
        else loadRequest.current?.abort();
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        Push notifications
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Push notifications</DialogTitle>
          <DialogDescription>
            For every device you turned notifications on in. A notification that
            is muted, waits past the quiet hours or goes over the limit is still
            on the bell and in your messages.
          </DialogDescription>
        </DialogHeader>

        {saved !== null && (
          <>
            <fieldset disabled={pending} className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">
                Notify me about
              </legend>
              {groups.map((group) => (
                <label className="flex gap-2 text-sm" key={group}>
                  <input
                    type="checkbox"
                    checked={!draft.muted.includes(group)}
                    onChange={(event) => {
                      setDraft({
                        ...draft,
                        muted: event.target.checked
                          ? draft.muted.filter((muted) => muted !== group)
                          : [...draft.muted, group],
                      });
                    }}
                  />
                  {labels[group]}
                </label>
              ))}
            </fieldset>

            <fieldset disabled={pending} className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">Quiet hours</legend>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.quiet}
                  onChange={(event) => {
                    setDraft({ ...draft, quiet: event.target.checked });
                  }}
                />
                Hold notifications overnight
              </label>
              {draft.quiet && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label htmlFor="quiet-from">From</Label>
                      <Input
                        id="quiet-from"
                        type="time"
                        required
                        value={draft.from}
                        onChange={(event) => {
                          setDraft({ ...draft, from: event.target.value });
                        }}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="quiet-to">Until</Label>
                      <Input
                        id="quiet-to"
                        type="time"
                        required
                        value={draft.to}
                        onChange={(event) => {
                          setDraft({ ...draft, to: event.target.value });
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {quietChanged ? "Changes will use" : "Times are in"} {zone}.
                  </p>
                </>
              )}
            </fieldset>

            <div className="grid gap-1">
              <Label id="push-limit-label">At most</Label>
              <Select
                value={draft.limit}
                items={Object.fromEntries(limits)}
                disabled={pending}
                onValueChange={(value: string | null) => {
                  if (value !== null) setDraft({ ...draft, limit: value });
                }}
              >
                <SelectTrigger aria-labelledby="push-limit-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {limits.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <p role="status" className="text-sm">
          {loading ? "Loading notification preferences…" : status}
        </p>
        <DialogFooter>
          <DialogClose disabled={pending} render={<Button variant="outline" />}>
            Close
          </DialogClose>
          {saved !== null ? (
            <Button loading={pending} onClick={() => void save()}>
              Save notification preferences
            </Button>
          ) : (
            <Button loading={loading} onClick={() => void load()}>
              Try again
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function accountChanged(error: unknown): error is ApiResponseError {
  return (
    error instanceof ApiResponseError && error.code === "PUSH_ACCOUNT_CHANGED"
  );
}
