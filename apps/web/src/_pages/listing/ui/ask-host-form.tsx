"use client";

import {
  startConversationSchema,
  type StartConversationInput,
} from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { Textarea } from "@repo/ui/components/textarea";
import { useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { startConversationAction } from "../api/start-conversation-action";

/**
 * A guest's question to the host, which opens the thread between them. `listingId` is a
 * bound value rather than a box, for the reason `BookingForm` gives.
 */
export const AskHostForm = ({ listingId }: { listingId: string }) => {
  const { form, submit, pending, message } =
    useActionForm<StartConversationInput>({
      action: startConversationAction.bind(null, listingId),
      schema: startConversationSchema,
      defaultValues: { body: "" },
      bound: { listingId },
    });

  return (
    // `method` and `noValidate` for the reasons `register-form.tsx` gives.
    <form method="post" onSubmit={submit} noValidate>
      <FieldGroup>
        <FormField
          form={form}
          name="body"
          label="Your question"
          limit={startConversationSchema.shape.body.maxLength}
        >
          {(control) => (
            <Textarea {...control} size="lg" rows={3} disabled={pending} />
          )}
        </FormField>

        {message !== null && <FieldError>{message}</FieldError>}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="submit" size="lg" loading={pending}>
            Send to the host
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
};
