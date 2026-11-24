"use client";

import { useState } from "react";
import {
  mailGroupSchema,
  type MailGroup,
  type MailSettings,
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
import { mailApi } from "#shared/api";

const labels: Record<MailGroup, string> = {
  stays: "Bookings and cancellations",
  payments: "Payments and payouts",
  messages: "Unread conversations",
  waitlist: "Waitlist openings",
};

export function EmailSettings({ settings }: { settings: MailSettings }) {
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [savedMuted, setSavedMuted] = useState(settings.muted);
  const [muted, setMuted] = useState(settings.muted);

  async function submit(action: "save" | "resend") {
    setPending(true);
    setStatus("");
    try {
      if (action === "save") {
        await mailApi.preferences(muted);
        setSavedMuted(muted);
        setStatus("Email preferences saved.");
      } else {
        await mailApi.resend();
        setStatus("Confirmation requested. Check your inbox.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(open, event) => {
        if (pending) event.cancel();
        else if (open) {
          setMuted(savedMuted);
          setStatus("");
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        Email notifications
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Email notifications</DialogTitle>
          {settings.undeliverable && (
            <DialogDescription>
              Delivery paused. Contact{" "}
              <a className="underline" href="mailto:support@staydesk.dev">
                support@staydesk.dev
              </a>{" "}
              to restore delivery, then request another confirmation.
            </DialogDescription>
          )}
        </DialogHeader>
        {settings.undeliverable && settings.canRequestConfirmation && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void submit("resend")}
          >
            Resend confirmation
          </Button>
        )}
        <fieldset disabled={pending} className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">
            Send me email about
          </legend>
          {mailGroupSchema.options.map((group) => (
            <label className="flex gap-2 text-sm" key={group}>
              <input
                type="checkbox"
                checked={!muted.includes(group)}
                onChange={(e) =>
                  setMuted(
                    e.target.checked
                      ? muted.filter((g) => g !== group)
                      : [...muted, group],
                  )
                }
              />
              {labels[group]}
            </label>
          ))}
        </fieldset>
        <p role="status">{status}</p>
        <DialogFooter>
          <DialogClose disabled={pending} render={<Button variant="outline" />}>
            Close
          </DialogClose>
          <Button disabled={pending} onClick={() => void submit("save")}>
            Save email preferences
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
