"use client";

import { useState } from "react";
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
import { FieldError } from "@repo/ui/components/field";
import { requestPasswordChangeAction } from "../api/request-password-change-action";

export function PasswordChangeDialog({ email }: { email: string }) {
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function requestLink() {
    setPending(true);
    setMessage(null);
    try {
      const error = await requestPasswordChangeAction();
      setMessage(error);
      setRequested(error === null);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      setMessage("The service is unavailable. Please try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(open, event) => {
        if (pending) event.cancel();
        else if (open) {
          setMessage(null);
          setRequested(false);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        Change password
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription className="wrap-anywhere">
            Request a link to set a new password using {email}.
          </DialogDescription>
        </DialogHeader>
        {message !== null && <FieldError>{message}</FieldError>}
        {requested && (
          <p role="status">
            Reset link requested. Check your inbox for the link.
          </p>
        )}
        <DialogFooter>
          <DialogClose disabled={pending} render={<Button variant="outline" />}>
            Close
          </DialogClose>
          <Button
            loading={pending}
            disabled={pending || requested}
            onClick={requestLink}
          >
            Send reset link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
