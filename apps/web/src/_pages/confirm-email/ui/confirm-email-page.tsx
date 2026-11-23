"use client";

import { useState } from "react";
import { Button } from "@repo/ui/components/button";
import { mailApi } from "#shared/api";
import { ButtonLink } from "#shared/ui";
import { ROUTES } from "#shared/config";

export function ConfirmEmailPage() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  async function confirm() {
    setMessage("");
    setPending(true);
    try {
      await mailApi.confirm(window.location.hash.slice(1));
      history.replaceState(null, "", location.pathname);
      setConfirmed(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to confirm your email.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="mx-auto grid max-w-md gap-4">
      <h1 className="text-2xl font-semibold">
        {confirmed ? "Email confirmed" : "Confirm your email address"}
      </h1>
      {confirmed ? (
        <ButtonLink href={ROUTES.profile}>Go to profile</ButtonLink>
      ) : (
        <Button disabled={pending} onClick={() => void confirm()}>
          Confirm email
        </Button>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
