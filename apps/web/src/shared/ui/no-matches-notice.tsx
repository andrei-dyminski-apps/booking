import { SearchXIcon } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";

/**
 * What a list shows when the API answered and the answer was empty because of the filters.
 * The way out is on the screen already — every chip above is a link to the same search
 * without one of them — so this says where to look rather than offering a button of its
 * own.
 *
 * The third sibling of `StalePageNotice` and `RefusedSearchNotice`, and here for the same
 * reason: both lists that page render it, and it is the one empty state the two screens
 * have to word identically. What is empty for any other reason is not this — an empty
 * catalogue and a guest with no stays are each a message about that list, and each stays
 * in its own slice.
 */
export const NoMatchesNotice = () => (
  <Empty className="border">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <SearchXIcon />
      </EmptyMedia>
      <EmptyTitle>Nothing matches this search</EmptyTitle>
      <EmptyDescription>
        The chips above take a filter off one at a time, and the search widens
        with each one.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);
