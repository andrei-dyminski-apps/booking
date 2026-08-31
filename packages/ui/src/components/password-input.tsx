"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { cn } from "#lib/utils";
import { Button } from "#components/button";
import { Input } from "#components/input";

function PasswordInput({
  className,
  disabled,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [revealed, setRevealed] = useState(false);

  return (
    // Whether the characters are on the screen is a property of this box and of nothing
    // else, so the state stays here: the form around it submits the same value either way.
    <div data-slot="password-input" className="relative">
      <Input
        type={revealed ? "text" : "password"}
        className={cn("pr-9", className)}
        disabled={disabled}
        {...props}
      />
      <Button
        // The native default inside a form is "submit", so without this the eye would send it.
        type="button"
        variant="ghost"
        size="icon-sm"
        // The label says what the click does rather than what the box is showing —
        // "Show password" beside visible characters is the other reading, and wrong.
        aria-label={revealed ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0.5 my-auto text-muted-foreground"
        disabled={disabled}
        onClick={() => {
          setRevealed((shown) => !shown);
        }}
      >
        {revealed ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  );
}

export { PasswordInput };
