"use client";

import { useEffect } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";

/**
 * The boundary React unwinds a failed render into. It is a client component because Next
 * requires one — the retry below re-renders the segment in the browser rather than
 * reloading the document.
 *
 * What it must not do is explain the failure: everything that reaches here is either a
 * drift from the contract or an API that answered with a 500, and both of those are for
 * the console. The transport already turns the two failures a visitor can do something
 * about into messages beside the form that provoked them.
 */
export const ErrorPage = ({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) => {
  useEffect(() => {
    // The server logs its own; this is the half that happened after hydration.
    console.error(error);
  }, [error]);

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon className="text-destructive" />
        </EmptyMedia>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>
          This page could not be rendered. Trying again is usually enough — the
          service it reads from may have been briefly unavailable.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={reset}>Try again</Button>
        {error.digest !== undefined && (
          <p className="text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
      </EmptyContent>
    </Empty>
  );
};
