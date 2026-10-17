"use client";

import { useState } from "react";
import { useController, type Control } from "react-hook-form";
import { StarIcon } from "lucide-react";
import {
  MAX_RATING,
  MIN_RATING,
  type CreateReviewInput,
} from "@repo/contracts";
import { Field, FieldError } from "@repo/ui/components/field";
import { cn } from "@repo/ui/lib/utils";
import { fieldMessages, messagesOf } from "#shared/lib";
import { HintFieldSet } from "#shared/ui";

const STARS = Array.from(
  { length: MAX_RATING - MIN_RATING + 1 },
  (_, index) => MIN_RATING + index,
);

/**
 * The rating as a row of stars to pick from: a radio per star, visually hidden, with the
 * star as its label — so the arrow keys move between them and a screen reader reads a
 * group of five choices rather than five pictures.
 *
 * It is a controller rather than `FormField`'s `register`, because a registered radio
 * hands `react-hook-form` its `value` as text and skips `setValueAs`, while the contract
 * wants a whole number: the star puts the number in itself.
 */
export const RatingField = ({
  control,
  disabled,
}: {
  control: Control<CreateReviewInput>;
  disabled: boolean;
}) => {
  const { field, fieldState } = useController({ control, name: "rating" });
  // The stars a pointer over the row would give, drawn ahead of the click — while the
  // stars can be picked at all, so a submit that starts under the pointer shows the value.
  const [hovered, setHovered] = useState<number | null>(null);

  const messages = messagesOf(fieldState.error);
  const errorId = messages === undefined ? undefined : "field-rating-error";
  const shown = disabled ? field.value : (hovered ?? field.value);

  return (
    <Field data-invalid={fieldState.invalid}>
      <HintFieldSet
        id="field-rating"
        label="Rating"
        description={`From ${String(MIN_RATING)} to ${String(MAX_RATING)} stars.`}
      >
        <div
          className="flex items-center gap-1"
          onPointerLeave={() => {
            setHovered(null);
          }}
        >
          {STARS.map((stars) => (
            <label
              key={stars}
              className={cn(
                "rounded-sm p-0.5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                // A refused submit focuses the first star from code, which `:focus-visible`
                // does not match after a click — so a wrong rating marks its focus anyway.
                "has-aria-invalid:has-focus:ring-3 has-aria-invalid:has-focus:ring-destructive/20 dark:has-aria-invalid:has-focus:ring-destructive/40",
                disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              )}
              onPointerEnter={() => {
                if (!disabled) setHovered(stars);
              }}
            >
              <input
                // The first star takes the ref, so a refused submit focuses the group.
                ref={stars === MIN_RATING ? field.ref : undefined}
                type="radio"
                name={field.name}
                value={stars}
                checked={field.value === stars}
                onChange={() => {
                  field.onChange(stars);
                }}
                onBlur={field.onBlur}
                disabled={disabled}
                aria-invalid={fieldState.invalid}
                aria-describedby={errorId}
                className="sr-only"
              />
              <StarIcon
                aria-hidden
                className={cn(
                  "size-7 transition-colors",
                  shown !== undefined && stars <= shown
                    ? "fill-foreground text-foreground"
                    : "text-muted-foreground/50",
                )}
              />
              <span className="sr-only">{`${String(stars)} out of ${String(MAX_RATING)} stars`}</span>
            </label>
          ))}
        </div>
      </HintFieldSet>

      <FieldError id={errorId} errors={fieldMessages(messages)} />
    </Field>
  );
};
