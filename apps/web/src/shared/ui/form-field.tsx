"use client";

import { useState, type ReactNode } from "react";
import {
  useFormState,
  type FieldValues,
  type Path,
  type RegisterOptions,
  type UseFormRegisterReturn,
  type UseFormReturn,
} from "react-hook-form";
import { Field, FieldError } from "@repo/ui/components/field";
import { fieldMessages, messagesOf } from "../lib";
import { CharacterCount } from "./character-count";
import { HintLabel, hintOf } from "./hint-label";

/**
 * What the control is handed: everything `register` returns, plus the three attributes a
 * box and its messages have to agree on. Spread it onto the control and nothing about the
 * wiring is left at the call site.
 */
export type FormControl<Name extends string> = UseFormRegisterReturn<Name> & {
  id: string;
  defaultValue: string | undefined;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
};

/**
 * One box of a form that submits to a Server Action — its label, its description, its
 * messages, and the attributes that tie the three to the control between them.
 *
 * It is here rather than in `@repo/ui` for the reason `FilterField` beside it is: it
 * speaks `react-hook-form` and ends in this application's `fieldMessages`, while what it
 * composes — `Field`, `FieldLabel`, `FieldError` — is what lives in the design system.
 *
 * The description is a hint beside the label, drawn by `HintLabel` as it is in a filter
 * dialog, rather than a line under the box: one spelling for every box that explains itself.
 *
 * The control is a child function rather than a prop, because the boxes differ: a
 * password reveals itself, a description is several lines, a price steps in cents. What
 * does not differ is what surrounds them.
 *
 * **The value is rendered by the server, not only put there by the browser.** `register`
 * leaves a box uncontrolled and reaches the DOM through a ref, which runs after hydration
 * — so without `defaultValue` the edit screen would be sent out with four empty boxes and
 * fill them in a moment later. It is the initial value and nothing after it, which is why
 * it is read once rather than off the form on every render: from the first keystroke the
 * value is `react-hook-form`'s, and handing the control a default that has moved with it
 * is how Base UI's `FieldControl` reads a box turning controlled — it says so in the
 * console. The DOM would ignore the new default either way, its own dirty-value flag
 * being up, so nothing is lost by never writing it again.
 *
 * **A bound on the text is drawn as a count, never as a limit on typing.** `limit` is the
 * schema's own `maxLength`, and what it produces is `CharacterCount` — a hundred
 * characters is not something anybody counts on sight, and the alternative, `maxLength` on
 * the control, would take the room away without a word about it. The number joins the
 * description in `aria-describedby`, so a box states its allowance when it takes focus.
 *
 * **`aria-describedby` is the other point of the component.** `aria-invalid` says that a box is
 * wrong and the message says what is wrong with it, and without the link between them a
 * screen reader announces the first and never reaches the second. The error's id is left
 * out while there is no error to point at — `FieldError` renders nothing at all in that
 * case, and a reference to an element that is not there is read as no description rather
 * than as an empty one.
 *
 * The ids are derived from the name rather than being it, for the reason `FilterField`
 * beside it gives: a label pointing at a bare `from` would follow whatever else on the
 * page ends up carrying that id.
 */
export const FormField = <Values extends FieldValues>({
  form,
  name,
  label,
  description,
  limit,
  options,
  children,
}: {
  form: UseFormReturn<Values>;
  name: Path<Values>;
  label: string;
  description?: string;
  /**
   * How long the contract lets this box's text be, for a box that takes text — read off
   * the schema (`createListingSchema.shape.title.maxLength`) rather than written down
   * again, and `null` there when the field has no bound at all. What it draws is a count
   * and never a limit on typing; `character-count.tsx` says why.
   */
  limit?: number | null;
  /** How the box's text becomes the value the contract expects — a price, a count. */
  options?: RegisterOptions<Values, Path<Values>>;
  children: (control: FormControl<Path<Values>>) => ReactNode;
}) => {
  // Subscribed by name rather than read off `form.formState`: this component renders
  // beside its siblings, and what it has to re-render for is a message about its own box.
  const formState = useFormState({ control: form.control, name });
  const { error, invalid } = form.getFieldState(name, formState);
  const messages = messagesOf(error);
  // The value the server rendered, taken at the first render and kept: see above.
  const [defaultValue] = useState(() => {
    const initial: unknown = form.getValues(name);

    return initial === undefined ? undefined : String(initial);
  });

  const id = `field-${name}`;
  const hint = hintOf(id, description);
  const countId = typeof limit === "number" ? `${id}-count` : undefined;
  const errorId = messages === undefined ? undefined : `${id}-error`;
  const describedBy = [hint?.id, countId, errorId].filter(isText).join(" ");

  return (
    <Field data-invalid={invalid}>
      <div className="flex justify-between gap-6 items-end">
        <HintLabel htmlFor={id} label={label} hint={hint} />

        {typeof limit === "number" && (
          <CharacterCount
            id={`${id}-count`}
            control={form.control}
            name={name}
            limit={limit}
          />
        )}
      </div>

      {children({
        ...form.register(name, options),
        id,
        defaultValue,
        "aria-invalid": invalid,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
      })}

      <FieldError id={errorId} errors={fieldMessages(messages)} />
    </Field>
  );
};

/** An id that is actually there — a description, a count and an error are each absent as `undefined`. */
function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
