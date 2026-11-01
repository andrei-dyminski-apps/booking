/** What the job last failed with, as it was recorded — a message for whoever fixes it. */
export const LastError = ({ error }: { error: string | null }) =>
  error === null ? (
    <p className="text-sm text-muted-foreground">No error was recorded.</p>
  ) : (
    <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap">
      {error}
    </p>
  );
