"use client";

import {
  resolveRefundFailureSchema,
  type ResolveRefundFailureInput,
} from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { Textarea } from "@repo/ui/components/textarea";
import { useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { resolveRefundFailureAction } from "../api/set-aside-actions";

/**
 * Recording how a bounced refund reached the guest after all. There is no "send it again":
 * the usual reason is a card that expired or was closed, and the same card refuses it
 * again — so the money goes back outside Stripe and this is the note of how it did.
 *
 * A box somebody types into, so it is `useActionForm` over `resolveRefundFailureSchema`.
 * A success closes nothing by hand: `refresh()` takes the row off the open list, and the
 * dialog goes with it.
 */
export const ResolveRefundButton = ({ refundId }: { refundId: string }) => {
  const { form, submit, pending, message } =
    useActionForm<ResolveRefundFailureInput>({
      action: resolveRefundFailureAction.bind(null, refundId),
      schema: resolveRefundFailureSchema,
      defaultValues: { resolution: "" },
    });

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="w-full sm:w-auto" />
        }
      >
        Mark as resolved
      </DialogTrigger>

      <DialogContent>
        {/* `method` and `noValidate` for the reasons `booking-form.tsx` gives. */}
        <form
          method="post"
          onSubmit={submit}
          noValidate
          className="flex flex-col gap-6"
        >
          <DialogHeader>
            <DialogTitle>How did the money go back?</DialogTitle>
            <DialogDescription>
              Nothing is sent from here. Record how the guest got their money —
              a bank transfer, a refund to another card — so the next admin
              knows it is settled.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <FormField
              form={form}
              name="resolution"
              label="Resolution"
              limit={resolveRefundFailureSchema.shape.resolution.maxLength}
            >
              {(control) => (
                <Textarea {...control} rows={4} disabled={pending} />
              )}
            </FormField>

            {message !== null && <FieldError>{message}</FieldError>}
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" loading={pending}>
              Mark as resolved
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
