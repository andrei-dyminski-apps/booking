import { Field, FieldError, FieldLabel } from "@repo/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { fieldMessages } from "#shared/lib";
import { statusOptions } from "../lib/bookings-search";

/**
 * The status box of the filter dialog, and the one control here that is not an `Input`.
 *
 * It is the design system's `Select`, styled to read as the boxes beside it. It submits
 * like a native control would: `name` plus an uncontrolled `defaultValue` let Base UI keep
 * a hidden input in step with the listbox, so `FilterForm` reads the choice out of
 * `FormData` exactly as it reads `from` and `to`, and a submit with no JavaScript carries
 * it too. No second input to place and no state to keep in step — which is what the
 * hand-rolled `<select>` that used to be here existed to avoid.
 *
 * The empty option is "no filter" rather than a status: `bookingQuerySchema` reads a blank
 * as the absence it means, which is what lets this form submit every field it has. A value
 * the contract refuses is shown as that empty option, the same fallback a native `<select>`
 * makes; the message below the box and the chip beside it are what report it.
 *
 * The trigger already shares its border, focus and invalid rings, height and chevron with
 * the `Input`s around it. The override only pulls it to full width and onto the input type
 * scale — `text-base` below `md`, which is what stops a phone zooming a focused field.
 */
export const StatusField = ({
  value,
  error,
}: {
  value: string;
  error: string[] | undefined;
}) => {
  const id = "filter-status";

  const labels: Record<string, string> = {
    "": "Any status",
    ...Object.fromEntries(
      statusOptions.map((option) => [option.value, option.label]),
    ),
  };

  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel htmlFor={id}>Status</FieldLabel>
      <Select
        name="status"
        defaultValue={value in labels ? value : ""}
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
          <SelectItem value="">Any status</SelectItem>
          {statusOptions.map((option) => (
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
