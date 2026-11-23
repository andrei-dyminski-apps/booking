"use client";

import { useState } from "react";
import {
  mailGroupSchema,
  type MailGroup,
  type MailSettings,
} from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
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
  const [muted, setMuted] = useState(settings.muted);
  async function submit(action: "save" | "resend") {
    setPending(true);
    try {
      if (action === "save") {
        await mailApi.preferences(muted);
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
    <section
      aria-labelledby="email-heading"
      className="grid gap-3 border-t pt-5"
    >
      <h2 id="email-heading" className="font-medium">
        Email notifications
      </h2>
      <p className="text-sm">
        {settings.undeliverable ? (
          <>
            Delivery paused. Contact{" "}
            <a className="underline" href="mailto:support@staydesk.dev">
              support@staydesk.dev
            </a>{" "}
            to restore delivery, then request another confirmation.
          </>
        ) : settings.verified ? (
          "Email confirmed"
        ) : settings.canRequestConfirmation ? (
          "Email unconfirmed"
        ) : (
          "Email confirmation is unavailable for this address."
        )}
      </p>
      {settings.canRequestConfirmation && (
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
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => void submit("save")}
      >
        Save email preferences
      </Button>
      <p role="status" className="text-sm">
        {status}
      </p>
    </section>
  );
}
