"use client";

import {
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { FieldDescription } from "@repo/ui/components/field";
import { cn } from "@repo/ui/lib/utils";

/**
 * How much of a box's allowance is used up, for a bound nobody can count on sight — a
 * hundred characters of a title, two thousand of a description.
 *
 * **It states the room left, it does not take it away.** `maxLength` on the control would
 * be the other choice, and it is the wrong one here: it is the one HTML constraint
 * `noValidate` does not switch off, so it would stand in front of the contract exactly
 * where every other rule of this form is the contract's to state — and it says nothing
 * while it does it. A pasted paragraph would lose its end in silence, where the sentence
 * the schema already has ("A description may not be longer than 2000 characters") reaches
 * the box either way. So a bound that is passed reads as a refusal rather than as a key
 * that stopped working.
 *
 * **The length is measured the way the contract measures it** — trimmed, because every
 * string schema here trims before it counts, and a count that promised room the schema
 * then refuses would be worse than none.
 *
 * **It subscribes by name, in a component of its own.** Whoever holds the subscription
 * re-renders on every keystroke, and that has to be this line rather than the form around
 * it — the same reason `FormField` reads its own state through `useFormState({ name })`.
 */
export const CharacterCount = <Values extends FieldValues>({
  id,
  control,
  name,
  limit,
}: {
  id: string;
  control: Control<Values>;
  name: Path<Values>;
  limit: number;
}) => {
  const value: unknown = useWatch({ control, name });
  const used = typeof value === "string" ? value.trim().length : 0;

  return (
    <FieldDescription
      id={id}
      className={cn(
        "text-right tabular-nums text-xs",
        used > limit && "text-destructive",
      )}
    >
      {/*
        One number, spelled twice: `12 / 100` is what fits beside a box, and what a screen
        reader has to be handed is a sentence. Neither is announced as it changes — this is
        no live region, and a count that spoke on every keystroke would be unusable — so it
        is read once, when the box takes focus and `aria-describedby` is followed.
      */}
      <span aria-hidden="true">
        {used} / {limit}
      </span>
      <span className="sr-only">
        {used} of {limit} characters
      </span>
    </FieldDescription>
  );
};
