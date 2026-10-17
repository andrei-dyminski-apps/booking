import type { ReactNode } from "react";

/**
 * The top of a screen: its name and one line on what is in it. `break-words` is for a
 * title or description that carries something a person typed — a listing's title, an
 * owner's name, which may be one word longer than the line.
 */
export const PageHeading = ({
  title,
  description,
}: {
  title: ReactNode;
  description: ReactNode;
}) => (
  <div className="flex flex-col gap-1">
    <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">
      {title}
    </h1>
    <p className="text-sm break-words text-muted-foreground">{description}</p>
  </div>
);
