import { addYears, format } from "date-fns";
import { CreditCardIcon } from "lucide-react";
import { CopyButton } from "@repo/ui/components/copy-button";
import { cn } from "@repo/ui/lib/utils";

const TEST_CARD_NUMBER = "4242 4242 4242 4242";

export const TestCardDetails = () => {
  const fields = [
    {
      label: "Card number",
      copyLabel: "Copy card number",
      display: TEST_CARD_NUMBER,
      value: TEST_CARD_NUMBER.replaceAll(" ", ""),
      wide: true,
    },
    {
      label: "Expiry date",
      copyLabel: "Copy expiry date",
      value: format(addYears(new Date(), 1), "MM/yy"),
    },
    { label: "CVC", copyLabel: "Copy CVC", value: "123" },
  ];

  return (
    <section
      aria-label="Test card details"
      className="flex flex-col gap-3 rounded-xl border bg-muted/50 p-3 sm:p-4"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <CreditCardIcon aria-hidden="true" className="size-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">Stripe test card</p>
          <p className="text-xs text-muted-foreground">
            Copy these values into the payment fields below.
          </p>
        </div>
      </div>

      <ul role="list" className="grid md:grid-cols-4 grid-cols-2 gap-2">
        {fields.map(({ label, copyLabel, display, value, wide }) => (
          <li
            key={label}
            className={cn(
              "flex items-center justify-between gap-2 rounded-lg border bg-background py-2 pr-2 pl-3",
              wide && "col-span-2",
            )}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{label}</span>
              <code className="text-sm font-semibold tabular-nums">
                {display ?? value}
              </code>
            </div>
            <CopyButton value={value} label={copyLabel} />
          </li>
        ))}
      </ul>
    </section>
  );
};
