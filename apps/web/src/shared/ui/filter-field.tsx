import { Button } from "@repo/ui/components/button";
import { Field, FieldError, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { InfoIcon } from "lucide-react";
import { fieldMessages } from "../lib";

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
 * its rhythm. It is a popover that opens on hover, not a tooltip — Base UI's tooltip never
 * opens on a tap, and a phone is where these dialogs are used most. The popup is only in
 * the DOM while it is open, so the same text is kept as a visually hidden description of
 * the box: a screen reader still hears it on focus.
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
  const descriptionId =
    description === undefined ? undefined : `${id}-description`;

  return (
    <Field data-invalid={error !== undefined}>
      <div className="flex items-center gap-1">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description !== undefined && (
          <Popover>
            <PopoverTrigger
              openOnHover
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={`About ${label}`}
                />
              }
            >
              <InfoIcon />
            </PopoverTrigger>
            <PopoverContent side="top" className="w-auto max-w-96">
              {description}
            </PopoverContent>
          </Popover>
        )}
      </div>
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
        aria-describedby={descriptionId}
      />
      {description !== undefined && (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      )}
      <FieldError errors={fieldMessages(error)} />
    </Field>
  );
};
