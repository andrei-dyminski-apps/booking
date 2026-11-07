"use client";

import { waiveHostFeeSchema, type WaiveHostFeeInput } from "@repo/contracts";
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
import { waiveFeeAction } from "../api/waive-fee-action";

/**
 * Forgiving what a host still owes of one fee, with the reason on record. A box somebody
 * types into, so it is `useActionForm` over `waiveHostFeeSchema`, as resolving a bounced
 * refund is. A success closes nothing by hand: `refresh()` redraws the row as waived, and
 * the button goes with it.
 */
export const WaiveFeeButton = ({ feeId }: { feeId: string }) => {
  const { form, submit, pending, message } = useActionForm<WaiveHostFeeInput>({
    action: waiveFeeAction.bind(null, feeId),
    schema: waiveHostFeeSchema,
    defaultValues: { reason: "" },
  });

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="w-full sm:w-auto" />
        }
      >
        Waive
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
            <DialogTitle>Waive this fee?</DialogTitle>
            <DialogDescription>
              What is still owed is forgiven and no longer kept back from the
              host&apos;s payouts. What was kept back already stays kept back.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <FormField
              form={form}
              name="reason"
              label="Reason"
              limit={waiveHostFeeSchema.shape.reason.maxLength}
            >
              {(control) => (
                <Textarea {...control} rows={3} disabled={pending} />
              )}
            </FormField>

            {message !== null && <FieldError>{message}</FieldError>}
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" loading={pending}>
              Waive the fee
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
