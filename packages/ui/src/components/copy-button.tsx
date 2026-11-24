"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "#components/button";

function CopyButton({
  value,
  label = "Copy to clipboard",
}: {
  value: string;
  label?: string;
}) {
  const [result, setResult] = useState<{ value: string } | null>(null);
  const copied = result?.value === value;

  useEffect(() => {
    if (result === null) return;

    const timeout = setTimeout(() => setResult(null), 2_000);

    return () => clearTimeout(timeout);
  }, [result]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setResult({ value });
    } catch {
      setResult(null);
      toast.error("Could not copy to clipboard.");
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        aria-label={label}
        title={copied ? "Copied" : label}
        onClick={() => void copy()}
      >
        {copied ? (
          <CheckIcon aria-hidden="true" className="text-primary" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
      </Button>
      <span role="status" className="sr-only">
        {copied && "Copied to clipboard."}
      </span>
    </>
  );
}

export { CopyButton };
