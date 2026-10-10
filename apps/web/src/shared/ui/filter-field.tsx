import { Field, FieldError } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { fieldMessages } from "../lib";
import { HintLabel, hintOf } from "./hint-label";

/**
 * One box of a search form — its label, its messages and the two attributes that have to
 * agree with them, written once for every screen that filters a list.
 *
 * It is here rather than in `@repo/ui` because it is not a primitive: it speaks this
 * application's `FieldErrors` and ends in the same `fieldMessages` line every other form
 * here ends in. What it composes — `Field` and `Input` — is what lives in the design
 * system.
 *
 * The `id` is derived from the name rather than being the name: these boxes are portalled
 * into a dialog, and a label of theirs pointing at a bare `from` would follow whatever
 * else on the page ends up carrying that id.
 *
 * The description is a hint behind an icon beside the label rather than a line under the
 * box: the dialog is a single column of boxes, and a paragraph under some of them breaks
 * its rhythm. `HintLabel` draws it, and says why it is kept a second time as a visually
 * hidden description of the box.
 *
 * Uncontrolled on purpose. Nothing resets these — a submit is a navigation, and the values
 * come back out of the URL the server rendered from.
 */
export const FilterField = ({
  name,
  label,
  type,
  value,
  error,
  min,
  step,
  description,
}: {
  name: string;
  label: string;
  type: "date" | "number" | "text";
  value: string;
  error: string[] | undefined;
  min?: string | number;
  /** Given only by a box that takes a fraction — a price, to the cent. */
  step?: string | number;
  description?: string;
}) => {
  const id = `filter-${name}`;
  const hint = hintOf(id, description);

  return (
    <Field data-invalid={error !== undefined}>
      <HintLabel htmlFor={id} label={label} hint={hint} />
      <Input
        id={id}
        name={name}
        type={type}
        min={min}
        step={step}
        // A step is what tells the two apart: a box that takes a fraction wants the
        // keypad with a separator on it, and one that counts guests does not.
        inputMode={
          type === "number"
            ? step === undefined
              ? "numeric"
              : "decimal"
            : undefined
        }
        defaultValue={value}
        aria-invalid={error !== undefined}
        aria-describedby={hint?.id}
      />
      <FieldError errors={fieldMessages(error)} />
    </Field>
  );
};
