import { StarIcon } from "lucide-react";
import { MAX_RATING } from "@repo/contracts";
import { cn } from "@repo/ui/lib/utils";

/**
 * A rating drawn as stars, with the number in words for whoever cannot see them: the
 * stars are decoration (`aria-hidden`) and the label is the reading. A fractional average
 * fills a star for every whole point and none for the rest — half-stars are a precision
 * the label already carries.
 */
export const RatingStars = ({
  rating,
  className,
}: {
  rating: number;
  className?: string;
}) => (
  <span
    role="img"
    aria-label={`${String(rating)} out of ${String(MAX_RATING)} stars`}
    className={cn("flex items-center gap-0.5", className)}
  >
    {Array.from({ length: MAX_RATING }, (_, index) => (
      <StarIcon
        key={index}
        aria-hidden
        className={cn(
          "size-4",
          index < Math.floor(rating)
            ? "fill-foreground text-foreground"
            : "text-muted-foreground/50",
        )}
      />
    ))}
  </span>
);
