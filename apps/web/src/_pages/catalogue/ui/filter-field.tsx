import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { fieldMessages } from "#shared/lib";

/**
 * One box of the catalogue's filters — its label, its messages and the two attributes that
 * have to agree with them, written once for the five of them.
 *
 * The `id` is derived from the name rather than being the name: these boxes are portalled
 * into the dialog, and a label of theirs pointing at a bare `from` would follow whatever
 * else on the page ends up carrying that id.
 *
 * Uncontrolled on purpose. Nothing resets these — a submit is a navigation, and the
 * values come back out of the URL the server rendered from.
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
  type: "date" | "number";
  value: string;
  error: string[] | undefined;
  min?: string | number;
  /** Given only by a box that takes a fraction — a price, to the cent. */
  step?: string | number;
  description?: string;
}) => {
  const id = `filter-${name}`;

  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
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
      />
      {description !== undefined && (
        <FieldDescription>{description}</FieldDescription>
      )}
      <FieldError errors={fieldMessages(error)} />
    </Field>
  );
};
