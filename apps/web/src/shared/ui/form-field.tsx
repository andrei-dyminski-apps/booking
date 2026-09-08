"use client";

import type { ReactNode } from "react";
import {
  useFormState,
  type FieldValues,
  type Path,
  type RegisterOptions,
  type UseFormRegisterReturn,
  type UseFormReturn,
} from "react-hook-form";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@repo/ui/components/field";
import { fieldMessages, messagesOf } from "../lib";

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
 * The control is a child function rather than a prop, because the boxes differ: a
 * password reveals itself, a description is several lines, a price steps in cents. What
 * does not differ is what surrounds them.
 *
 * **The value is rendered by the server, not only put there by the browser.** `register`
 * leaves a box uncontrolled and reaches the DOM through a ref, which runs after hydration
 * — so without `defaultValue` the edit screen would be sent out with four empty boxes and
 * fill them in a moment later. It is the initial value only, and not because React stops
 * writing it: React goes on setting `defaultValue` on every render, and what keeps that
 * from moving what is on the screen is the DOM's own dirty-value flag, raised the moment
 * the visitor types. So the field's state is `react-hook-form`'s from the first keystroke.
 *
 * **`aria-describedby` is the other point of the component.** `aria-invalid` says that a box is
 * wrong and the message says what is wrong with it, and without the link between them a
 * screen reader announces the first and never reaches the second. The error's id is left
 * out while there is no error to point at — `FieldError` renders nothing at all in that
 * case, and a reference to an element that is not there is read as no description rather
 * than as an empty one.
 *
 * The three ids are derived from the name rather than being it, for the reason
 * `FilterField` beside it gives: a label pointing at a bare `from` would follow whatever
 * else on the page ends up carrying that id.
 */
export const FormField = <Values extends FieldValues>({
  form,
  name,
  label,
  description,
  options,
  children,
}: {
  form: UseFormReturn<Values>;
  name: Path<Values>;
  label: string;
  description?: string;
  /** How the box's text becomes the value the contract expects — a price, a count. */
  options?: RegisterOptions<Values, Path<Values>>;
  children: (control: FormControl<Path<Values>>) => ReactNode;
}) => {
  // Subscribed by name rather than read off `form.formState`: this component renders
  // beside its siblings, and what it has to re-render for is a message about its own box.
  const formState = useFormState({ control: form.control, name });
  const { error, invalid } = form.getFieldState(name, formState);
  const messages = messagesOf(error);
  const value: unknown = form.getValues(name);

  const id = `field-${name}`;
  const descriptionId =
    description === undefined ? undefined : `${id}-description`;
  const errorId = messages === undefined ? undefined : `${id}-error`;
  const describedBy = [descriptionId, errorId].filter(isText).join(" ");

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>

      {children({
        ...form.register(name, options),
        id,
        defaultValue: value === undefined ? undefined : String(value),
        "aria-invalid": invalid,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
      })}

      {description !== undefined && (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      )}

      <FieldError id={errorId} errors={fieldMessages(messages)} />
    </Field>
  );
};

/** An id that is actually there — the description's and the error's are absent as `undefined`. */
function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
