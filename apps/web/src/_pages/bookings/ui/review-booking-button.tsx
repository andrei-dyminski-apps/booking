"use client";

import {
  createReviewSchema,
  MAX_RATING,
  MIN_RATING,
  type CreateReviewInput,
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
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { useActionForm } from "#shared/lib";
import { FormField } from "#shared/ui";
import { reviewBookingAction } from "../api/review-booking-action";

/**
 * What each side of a stay is asked, in its own words: the guest about the place, the
 * host about the guest. The API decides which half a submit writes from the session —
 * this only decides what to call it.
 */
const COPY = {
  listing: {
    trigger: "Review the stay",
    title: "How was the stay?",
    description:
      "Your review is shown on the listing's page to everybody who looks at it.",
  },
  guest: {
    trigger: "Review the guest",
    title: "How was the guest?",
    description:
      "Your review is read by the guest, by other hosts they ask to stay with, and by the site's admins — not by the public.",
  },
} as const;

/**
 * One half of a finished stay, in a dialog over the list of stays. A form with a box
 * somebody types into, so it is `useActionForm` over `createReviewSchema` like every other
 * such form here — the browser refuses a short review where it was typed, and the action
 * refuses it again.
 *
 * A success closes nothing by hand: `refresh()` brings the card back saying the stay is
 * reviewed, and this button — the dialog with it — is no longer drawn.
 */
export const ReviewBookingButton = ({
  bookingId,
  listingId,
  about,
}: {
  bookingId: string;
  /** The listing whose cached reviews take this one — the guest's half only. */
  listingId: string | null;
  about: keyof typeof COPY;
}) => {
  const { form, submit, pending, message } = useActionForm<CreateReviewInput>({
    action: reviewBookingAction.bind(null, bookingId, listingId),
    schema: createReviewSchema,
    defaultValues: { rating: undefined, comment: "" },
  });
  const copy = COPY[about];

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        {copy.trigger}
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
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <FormField
              form={form}
              name="rating"
              label="Rating"
              description={`From ${String(MIN_RATING)} to ${String(MAX_RATING)} stars.`}
              options={{ setValueAs: toRating }}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  min={MIN_RATING}
                  max={MAX_RATING}
                  step={1}
                  size="lg"
                  disabled={pending}
                />
              )}
            </FormField>

            <FormField
              form={form}
              name="comment"
              label="Review"
              limit={createReviewSchema.shape.comment.maxLength}
            >
              {(control) => (
                <Textarea {...control} size="lg" rows={5} disabled={pending} />
              )}
            </FormField>

            {message !== null && <FieldError>{message}</FieldError>}
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" loading={pending}>
              Publish the review
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Text onto the number the contract wants, with an empty box as `undefined` rather than
 * `0` — the reason `toNumber` in `features/save-listing/lib/to-number.ts` gives: the
 * schema then says a rating is required, which is what happened.
 */
function toRating(value: string | number | undefined): number | undefined {
  if (typeof value === "number" || value === undefined) return value;

  return value.trim() === "" ? undefined : Number(value);
}
