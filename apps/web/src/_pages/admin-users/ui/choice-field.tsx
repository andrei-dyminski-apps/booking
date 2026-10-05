import { Field, FieldError, FieldLabel } from "@repo/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { fieldMessages } from "#shared/lib";

/**
 * A box of the filter dialog that picks one value out of a closed set — the role and the
 * status. It is the stays screen's `StatusField` with the set handed in, for the reasons
 * that one gives: the design system's `Select` submits through `name` like a native
 * control, and the empty option is "no filter" rather than a value, which is what lets
 * the form submit every box it has.
 */
export const ChoiceField = ({
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
