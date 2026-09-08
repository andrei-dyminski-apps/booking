"use client";

import {
  useActionState,
  useEffect,
  useRef,
  type BaseSyntheticEvent,
} from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from "react-hook-form";
import type { ZodType } from "zod";
import { NO_FORM_ERRORS, type FormErrors } from "./form-errors";

/**
 * A form that validates in the browser against the contract and submits to a Server
 * Action — the shape every form here has except the login one, which has to work before
 * React has hydrated and therefore stays a plain `action={...}` submit.
 *
 * What it buys over that plain submit is the round trip an obvious mistake no longer
 * costs: the same schema Nest validates the body with runs on a field as it is left, so a
 * password that is too short is refused where it was typed rather than a request later.
 * The action still parses everything it is handed — it is an endpoint of its own, and
 * nothing about a payload assembled in a browser is evidence.
 *
 * The three pieces it ties together, none of which knows about the other two:
 *
 * - `useForm` holds the values and the refusals the schema can decide here;
 * - `useActionState` holds what came back from the server, and whether it is still out;
 * - `setError` puts the second of those under the fields of the first, so a refusal from
 *   the API and one from the schema reach the screen through the same line of markup.
 *
 * What it costs is the one thing the login form may not spend: with the submit handled
 * here, the values travel as an object rather than as `FormData`, and a page whose script
 * never arrived has no submit left. A form that ends up in that state has to say so in its
 * markup — `method="post"`, or the browser falls back to a `GET` of its own URL and writes
 * every box into the address bar. See `register-form.tsx`, where that is a password.
 */
export function useActionForm<Values extends FieldValues>({
  action,
  schema,
  defaultValues,
  bound,
}: {
  /** Already bound to whatever the screen decides — an id, a `?next=`. */
  action: (state: FormErrors, values: Values) => Promise<FormErrors>;
  /** The contract schema. The action validates against the same one. */
  schema: ZodType<Values, Values>;
  /**
   * Every box of the form, and nothing else: these keys are also what tells a message the
   * server sent back apart from one about a field this form does not draw.
   */
  defaultValues: DefaultValues<Values>;
  /**
   * What the schema needs and no box holds — the listing a booking is taken against, bound
   * by the page it was made from. The form carries it so the browser can parse against the
   * whole contract schema rather than a narrower copy of it, and it stays out of
   * `defaultValues` because those name the boxes: a refusal about a field with nothing on
   * the screen is dropped rather than given a message nobody will read and the focus of the
   * one they could fix. The action binds the same value again and overwrites what arrives.
   */
  bound?: DefaultValues<Values>;
}): {
  form: UseFormReturn<Values>;
  /** The `onSubmit` of the `<form>`: validate, then hand the values to the action. */
  submit: (event?: BaseSyntheticEvent) => Promise<void>;
  pending: boolean;
  /** What the whole form was refused for, when it was not one field's fault. */
  message: string | null;
} {
  const [errors, dispatch, pending] = useActionState<FormErrors, Values>(
    action,
    NO_FORM_ERRORS,
  );

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    // What the form holds, which is not the same as what it draws: the bound values go in
    // so the schema has the whole payload to judge, and only `defaultValues` goes into
    // `fields` below.
    defaultValues: { ...defaultValues, ...bound },
    // A box is judged when it is left rather than as it is typed in — a password refused
    // at the first character is a message that stays wrong for as long as it takes to
    // type a right one — and from then on it is judged again on every keystroke, so the
    // message goes away at the moment the mistake does.
    mode: "onBlur",
    reValidateMode: "onChange",
    // A field can break more than one rule at once, and `FieldError` already draws a list.
    criteriaMode: "all",
  });

  const { setError } = form;

  // The boxes of a form do not change while it is on the screen, while `defaultValues`
  // is an object literal that is new on every render. Reading the names once is what
  // keeps the effect below reacting to an answer from the server and to nothing else —
  // re-running it per render would put a refusal back under a field the visitor has
  // since corrected.
  const fields = useRef(defaultValues).current;

  useEffect(() => {
    // The server keys its messages by field name, and a name is a string until something
    // says it is one of this form's boxes. A name with nothing on the screen under it is
    // dropped rather than stored where nothing renders it.
    const isFieldOfThisForm = (name: string): name is Path<Values> =>
      name in fields;

    let unfocused = true;

    for (const [name, messages] of Object.entries(errors.fields)) {
      if (!isFieldOfThisForm(name)) continue;

      const [message] = messages;

      if (message === undefined) continue;

      // The first refusal takes the focus, and only the first: a page that scrolled to
      // the last of them would leave the visitor above the one they have to fix.
      setError(
        name,
        {
          type: "server",
          message,
          // A rule about a pair of fields is reported under each of them, and a field can
          // collect more than one message either way. `message` is the first of them
          // because that is the one field state carries; the rest travel here.
          types: Object.fromEntries(
            messages.map((text, index) => [`server-${String(index)}`, text]),
          ),
        },
        { shouldFocus: unfocused },
      );

      unfocused = false;
    }
  }, [errors, fields, setError]);

  return {
    form,
    submit: form.handleSubmit((values) => {
      dispatch(values);
    }),
    pending,
    message: errors.message,
  };
}
