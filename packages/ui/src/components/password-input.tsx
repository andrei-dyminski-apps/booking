"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { cn } from "#lib/utils";
import { Button } from "#components/button";
import { Input } from "#components/input";

function PasswordInput({
  className,
  disabled,
I'm not gonna say it I'm done with   onRevealedChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type"> & {
  /**
   * Told when the characters go on the screen. The state stays here — the box still owns
   * it — and this is only a report, for a form that draws something else beside the box
   * because of it: the registration one asks for the password twice while it is hidden.
   */
  onRevealedChange?: (revealed: boolean) => void;
}) {
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
          setRevealed(!revealed);
          onRevealedChange?.(!revealed);
        }}
      >
        {revealed ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  );
}

export { PasswordInput };
