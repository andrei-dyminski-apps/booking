"use client";

import { useRouter } from "next/navigation";
import { sendMessageSchema, type SendMessageInput } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import { FieldError, FieldGroup } from "@repo/ui/components/field";
import { Textarea } from "@repo/ui/components/textarea";
import { ROUTES } from "#shared/config";
import { useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { sendMessageAction } from "../api/send-message-action";

/**
 * The reply box under a thread. `sendMessageSchema` refuses an empty message here and
 * again in the action; the thread is bound by the page, never typed.
 *
 * **The box empties on a send that landed, and on nothing else.** Not by a remount keyed by
 * what the page drew: every render the thread goes through — a reply arriving live, a
 * message from the visitor's other tab, a turn to an earlier page — would decide anew what
 * the key is, and each change would throw a draft away. A send from an earlier page goes to
 * the newest one afterwards, where the message just written is.
 */
export const SendMessageForm = ({
  conversationId,
  earlier,
}: {
  conversationId: string;
  /** Drawn under an earlier page of the thread rather than its end. */
  earlier: boolean;
}) => {
  const router = useRouter();
  const { form, submit, pending, message } = useActionForm<SendMessageInput>({
    action: sendMessageAction.bind(null, conversationId),
    schema: sendMessageSchema,
    defaultValues: { body: "" },
    onSuccess: (sent) => {
      sent.reset();

      if (earlier) router.push(ROUTES.conversation(conversationId));
    },
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
