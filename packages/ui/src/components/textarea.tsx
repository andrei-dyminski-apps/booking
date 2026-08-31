import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#lib/utils";

const textareaVariants = cva(
  // The type scale is not one of the variants, for the reason `inputVariants` gives.
  "flex field-sizing-content w-full rounded-lg border border-input bg-transparent text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      size: {
        sm: "min-h-12 px-2.5 py-1.5",
        default: "min-h-16 px-2.5 py-2",
        lg: "min-h-24 px-3 py-2.5",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function Textarea({
  className,
  size,
  ...props
}: Omit<React.ComponentProps<"textarea">, "size"> &
  VariantProps<typeof textareaVariants>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(textareaVariants({ size }), className)}
      {...props}
    />
  );
}

export { Textarea, textareaVariants };
