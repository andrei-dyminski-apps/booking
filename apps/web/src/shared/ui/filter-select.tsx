import { Field, FieldError, FieldLabel } from "@repo/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { fieldMessages } from "../lib";

/**
 * One box of a search form that picks a value out of a closed set — a status, a role. It
 * is `FilterField` for a set rather than for text, and it sits beside it for the same
 * reason: every screen that filters a list draws one, and the set itself is written by the
 * slice that knows what is being filtered.
 *
 * It is the design system's `Select`, styled to read as the boxes beside it. It submits
 * like a native control would: `name` plus an uncontrolled `defaultValue` let Base UI keep
 * a hidden input in step with the listbox, so `FilterForm` reads the choice out of
 * `FormData` exactly as it reads an `Input`, and a submit with no JavaScript carries it too.
 *
 * The empty option is "no filter" rather than a value: the query schemas of the contract
 * read a blank as the absence it means, which is what lets a form submit every field it
 * has. A value the contract refuses is shown as that empty option, the same fallback a
 * native `<select>` makes; the message below the box and the chip beside it are what
 * report it.
 *
 * The trigger already shares its border, focus and invalid rings, height and chevron with
 * the `Input`s around it. The override only pulls it to full width and onto the input type
 * scale — `text-base` below `md`, which is what stops a phone zooming a focused field.
 */
export const FilterSelect = ({
  name,
  label,
  anyLabel,
  options,
  value,
  error,
}: {
  name: string;
  label: string;
  /** What the empty option says — "Any role", "Any status". */
  anyLabel: string;
  options: { value: string; label: string }[];
  value: string;
  error: string[] | undefined;
}) => {
  const id = `filter-${name}`;

  const labels: Record<string, string> = {
    "": anyLabel,
    ...Object.fromEntries(
      options.map((option) => [option.value, option.label]),
    ),
  };

  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        name={name}
        defaultValue={Object.hasOwn(labels, value) ? value : ""}
        items={labels}
      >
        <SelectTrigger
          id={id}
          aria-invalid={error !== undefined}
          className="w-full min-w-0 text-base md:text-sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{anyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError errors={fieldMessages(error)} />
    </Field>
  );
};
