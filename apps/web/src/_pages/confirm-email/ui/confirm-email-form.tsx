"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@repo/ui/components/button";
import { authApi, mailApi } from "#shared/api";
import { ButtonLink } from "#shared/ui";
import { ROUTES } from "#shared/config";

export function ConfirmEmailForm({ change = false }: { change?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [refreshing, startTransition] = useTransition();

  async function confirm() {
    setMessage("");
    setPending(true);
    try {
      const token = window.location.hash.slice(1);
      await (change
        ? authApi.confirmEmailChange(token)
        : mailApi.confirm(token));
      history.replaceState(null, "", location.pathname + location.search);
      if (change) {
        startTransition(() => {
          router.refresh();
          setConfirmed(true);
        });
      } else {
        setConfirmed(true);
      }
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
        <ButtonLink href={change ? ROUTES.login : ROUTES.profile}>
          {change ? "Sign in with your new email" : "Go to profile"}
        </ButtonLink>
      ) : (
        <Button disabled={pending || refreshing} onClick={() => void confirm()}>
          Confirm email
        </Button>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
