import type { ReactNode } from "react";

/**
 * The top of a list screen: its name and one line on what is in it. `break-words` is for
 * a description that carries an address — an owner's email has no place to wrap.
 */
export const PageHeading = ({
  title,
  description,
}: {
  title: ReactNode;
  description: ReactNode;
}) => (
  <div className="flex flex-col gap-1">
    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    <p className="text-sm break-words text-muted-foreground">{description}</p>
  </div>
);
