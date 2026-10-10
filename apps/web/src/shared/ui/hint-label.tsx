import { Button } from "@repo/ui/components/button";
import { FieldLabel, FieldLegend, FieldSet } from "@repo/ui/components/field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

/** The hint of a box and the id its hidden copy carries — one value for both ends. */
export type Hint = { id: string; text: string };

/** The hint of the box or the group `id` names, or nothing when it has no description. */
export const hintOf = (
  id: string,
  description: string | undefined,
): Hint | undefined =>
  description === undefined
    ? undefined
    : { id: `${id}-description`, text: description };

/**
 * The label of a box, and its description as a hint behind an icon beside it — shared by
 * every box with a description, in a filter dialog (`FilterField`, `LookupField`) and in a
 * form that submits (`FormField`), so a description is never a paragraph under one box
 * and an icon beside the next.
 *
 * The hint is a popover that opens on hover, not a tooltip: Base UI's tooltip never opens
 * on a tap, and a phone is where these screens are used most. The popup is only in the DOM
 * while it is open, so the same text is rendered here a second time, visually hidden, for
 * the box to name in `aria-describedby`. The box and the label are handed the same `Hint`,
 * so the reference and the element it points at cannot name two ids. It sits beside the
 * label rather than in it: inside the `<label>` it would become part of the box's name and
 * be read twice.
 */
export const HintLabel = ({
  htmlFor,
  label,
  hint,
}: {
  htmlFor: string;
  label: string;
  hint: Hint | undefined;
}) => (
  <div className="flex items-center gap-1">
    <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
    {hint !== undefined && <HintPopover label={label} hint={hint} />}
  </div>
);

/**
 * `HintLabel` for a group of boxes: a `FieldSet` whose `<legend>` carries the hint beside
 * it, the description drawn the same way `HintLabel` draws a box's.
 *
 * A legend has to be the fieldset's first child to name it, so the icon cannot sit beside
 * it in a wrapper the way it does beside a label — it goes inside, and with it the
 * button's own name would join the group's. So the text of the legend carries an id and
 * the fieldset names it in `aria-labelledby`, which wins over the legend, and the hint's
 * id goes into its `aria-describedby`. Both ids are derived from `id` here rather than
 * handed in, so the references and the elements they point at cannot drift apart.
 */
export const HintFieldSet = ({
  id,
  label,
  description,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  children: ReactNode;
}) => {
  const labelId = `${id}-label`;
  const hint = hintOf(id, description);

  return (
    <FieldSet aria-labelledby={labelId} aria-describedby={hint?.id}>
      <FieldLegend variant="label" className="flex items-center gap-1">
        <span id={labelId}>{label}</span>
        {hint !== undefined && <HintPopover label={label} hint={hint} />}
      </FieldLegend>

      {children}
    </FieldSet>
  );
};

const HintPopover = ({ label, hint }: { label: string; hint: Hint }) => (
  <>
    <Popover>
      <PopoverTrigger
        openOnHover
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground -my-0.5"
            aria-label={`About ${label}`}
          />
        }
      >
        <InfoIcon />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-auto max-w-96">
        {hint.text}
      </PopoverContent>
    </Popover>
    <span id={hint.id} className="sr-only">
      {hint.text}
    </span>
  </>
);
