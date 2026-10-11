"use client";

import { sendMessageSchema, type SendMessageInput } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { Textarea } from "@repo/ui/components/textarea";
import { useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { sendMessageAction } from "../api/send-message-action";

/**
 * The reply box under a thread. `sendMessageSchema` refuses an empty message here and
 * again in the action; the thread is bound by the page, never typed. The page remounts
 * this form when the thread gains a message, which is what empties the box after a send.
 */
export const SendMessageForm = ({
  conversationId,
}: {
  conversationId: string;
}) => {
  const { form, submit, pending, message } = useActionForm<SendMessageInput>({
    action: sendMessageAction.bind(null, conversationId),
    schema: sendMessageSchema,
    defaultValues: { body: "" },
  });

  return (
    // `method` and `noValidate` for the reasons `register-form.tsx` gives.
    <form method="post" onSubmit={submit} noValidate>
      <FieldGroup>
        <FormField
          form={form}
          name="body"
          label="Your message"
          limit={sendMessageSchema.shape.body.maxLength}
        >
          {(control) => (
            <Textarea {...control} size="lg" rows={3} disabled={pending} />
          )}
        </FormField>

        {message !== null && <FieldError>{message}</FieldError>}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="submit" size="lg" loading={pending}>
            Send
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
};
