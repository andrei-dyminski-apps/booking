import { Button } from "@repo/ui/components/button";
import { FieldLabel } from "@repo/ui/components/field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { InfoIcon } from "lucide-react";

/** The hint of a box and the id its hidden copy carries — one value for both ends. */
export type FilterHint = { id: string; text: string };

/** The hint of the box `htmlFor` names, or nothing when the box has no description. */
export const filterHint = (
  htmlFor: string,
  description: string | undefined,
): FilterHint | undefined =>
  description === undefined
    ? undefined
    : { id: `${htmlFor}-description`, text: description };

/**
 * The label of a box in a filter dialog, and the hint behind an icon beside it — shared by
 * the plain boxes (`FilterField`) and the ones that look a row up (`LookupField`), so the
 * dialog keeps one rhythm whichever kind it holds.
 *
 * The hint is a popover that opens on hover, not a tooltip: Base UI's tooltip never opens
 * on a tap, and a phone is where these dialogs are used most. The popup is only in the DOM
 * while it is open, so the same text is rendered here a second time, visually hidden, for
 * the box to name in `aria-describedby`. The box and the label are handed the same
 * `FilterHint`, so the reference and the element it points at cannot name two ids. It
 * sits beside the label rather than in it: inside the `<label>` it would become part of
 * the box's name and be read twice.
 */
export const FilterLabel = ({
  htmlFor,
  label,
  hint,
}: {
  htmlFor: string;
  label: string;
  hint: FilterHint | undefined;
}) => (
  <div className="flex items-center gap-1">
    <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
    {hint !== undefined && (
      <>
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
            {hint.text}
          </PopoverContent>
        </Popover>
        <span id={hint.id} className="sr-only">
          {hint.text}
        </span>
      </>
    )}
  </div>
);
